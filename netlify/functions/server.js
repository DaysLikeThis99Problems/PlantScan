const express = require("express");
const serverless = require("serverless-http");
const path = require("path");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch");

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Configure cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log("Cloudinary Configuration:", {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY ? "present" : "missing",
  api_secret: process.env.CLOUDINARY_API_SECRET ? "present" : "missing",
});

// Configure Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "plant-analysis",
    allowed_formats: ["jpg", "jpeg", "png"],
    transformation: [{ width: 1024, height: 1024, crop: "limit" }],
    public_id: (req, file) => `plant_${Date.now()}`,
  },
});

// Configure multer with Cloudinary storage
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log("Multer processing file:", {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    // Check file type
    if (!file.mimetype.startsWith("image/")) {
      console.log("File rejected: not an image");
      return cb(new Error("Only image files are allowed"), false);
    }

    // Check file extension
    const allowedExtensions = ["jpg", "jpeg", "png"];
    const extension = file.originalname.split(".").pop().toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      console.log("File rejected: invalid extension");
      return cb(
        new Error("Only .jpg, .jpeg, and .png files are allowed"),
        false
      );
    }

    console.log("File accepted");
    cb(null, true);
  },
});

// Helper function to resolve paths
const resolvePath = (relativePath) => {
  // First try from process.cwd()
  const cwdPath = path.join(process.cwd(), relativePath);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  // Then try from /var/task
  const taskPath = path.join("/var/task", relativePath);
  if (fs.existsSync(taskPath)) {
    return taskPath;
  }

  // Finally try from __dirname
  const dirPath = path.join(__dirname, "../../", relativePath);
  if (fs.existsSync(dirPath)) {
    return dirPath;
  }

  console.warn(`Could not resolve path for: ${relativePath}`);
  return cwdPath; // Return default path even if it doesn't exist
};

// Initialize express app
const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests
app.use((req, res, next) => {
  console.log("Request received:", {
    method: req.method,
    path: req.path,
    contentType: req.headers["content-type"],
  });
  next();
});

// Test endpoint
app.get("/test", (req, res) => {
  res.json({
    status: "ok",
    env: {
      cloudinary: process.env.CLOUDINARY_CLOUD_NAME ? "configured" : "missing",
      gemini: process.env.GEMINI_API_KEY ? "configured" : "missing",
    },
  });
});

// Upload endpoint
app.post("/upload", (req, res) => {
  upload(req, res, async function (err) {
    if (err) {
      console.error("Multer error:", err);
      return res.status(400).json({ error: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log("File received:", {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      // Upload to Cloudinary
      const b64 = Buffer.from(req.file.buffer).toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;

      const cloudinaryResult = await cloudinary.uploader.upload(dataURI, {
        folder: "plants",
      });

      console.log("Cloudinary upload successful:", cloudinaryResult.secure_url);

      res.json({
        success: true,
        url: cloudinaryResult.secure_url,
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });
});

// Analyze endpoint
app.post("/analyze", (req, res) => {
  upload(req, res, async function (err) {
    if (err) {
      console.error("Multer error:", err);
      return res.status(400).json({ error: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log("File received for analysis:", {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      // Upload to Cloudinary
      const b64 = Buffer.from(req.file.buffer).toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;

      const cloudinaryResult = await cloudinary.uploader.upload(dataURI, {
        folder: "plants",
      });

      console.log("Cloudinary upload successful:", cloudinaryResult.secure_url);

      // Initialize Gemini
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

      // Analyze with Gemini
      const result = await model.generateContent([
        "Analyze this plant image and provide: 1) Plant Species 2) Health Status 3) Care Instructions",
        {
          inlineData: {
            mimeType: req.file.mimetype,
            data: b64,
          },
        },
      ]);

      const analysis = result.response.text();
      console.log("Analysis completed, length:", analysis.length);

      res.json({
        success: true,
        image: cloudinaryResult.secure_url,
        analysis: analysis,
      });
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: error.message });
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({ error: err.message });
});

// Create handler
const handler = serverless(app);

// Export handler with CORS
exports.handler = async (event, context) => {
  // Add CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  // Handle OPTIONS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
    };
  }

  try {
    // Log the incoming request
    console.log("Incoming request:", {
      method: event.httpMethod,
      path: event.path,
      headers: event.headers,
    });

    const result = await handler(event, context);

    // Add CORS headers to response
    return {
      ...result,
      headers: { ...result.headers, ...headers },
    };
  } catch (error) {
    console.error("Handler error:", error);
    return {
      statusCode: 500,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
