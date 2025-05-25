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
const ejs = require("ejs");

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

// Configure view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../../views"));

// Serve static files
app.use(express.static(path.join(__dirname, "../../public")));

// Log incoming requests
app.use((req, res, next) => {
  console.log("Request:", {
    method: req.method,
    path: req.path,
    headers: req.headers,
  });
  next();
});

// Custom render function for Netlify
const renderView = async (view, options = {}) => {
  const viewPath = path.join(__dirname, "../../views", `${view}.ejs`);
  try {
    console.log("Rendering view:", viewPath);
    const html = await ejs.renderFile(viewPath, options);
    return html;
  } catch (error) {
    console.error("View render error:", error);
    throw error;
  }
};

// // Log all requests
// app.use((req, res, next) => {
//   console.log("Request received:", {
//     method: req.method,
//     path: req.path,
//     contentType: req.headers["content-type"],
//   });
//   next();
// });

// Route handlers
app.get("/", async (req, res) => {
  try {
    const html = await renderView("index");
    res.send(html);
  } catch (error) {
    res.status(500).json({ error: "Failed to render index page" });
  }
});

app.get("/login", async (req, res) => {
  try {
    const html = await renderView("login");
    res.send(html);
  } catch (error) {
    console.error("Login page render error:", error);
    res.status(500).json({ error: "Failed to render login page" });
  }
});

app.get("/register", async (req, res) => {
  try {
    const html = await renderView("register");
    res.send(html);
  } catch (error) {
    console.error("Register page render error:", error);
    res.status(500).json({ error: "Failed to render register page" });
  }
});

app.get("/dashboard", async (req, res) => {
  try {
    // Add any data you want to pass to the dashboard
    const dashboardData = {
      user: req.user, // If you have user data
      recentAnalyses: [], // Add your data here
    };
    const html = await renderView("dashboard", dashboardData);
    res.send(html);
  } catch (error) {
    console.error("Dashboard page render error:", error);
    res.status(500).json({ error: "Failed to render dashboard page" });
  }
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
app.get("/analyze", async (req, res) => {
  try {
    const html = await renderView("analyze", {
      error: null,
      result: null,
    });
    res.send(html);
  } catch (error) {
    console.error("Analyze page render error:", error);
    res.status(500).json({ error: "Failed to render analyze page" });
  }
});

app.post("/analyze", upload.single("image"), async (req, res) => {
  console.log("Analyze endpoint hit with request:", {
    headers: req.headers,
    file: req.file
      ? {
          path: req.file.path,
          mimetype: req.file.mimetype,
          size: req.file.size,
        }
      : "No file",
  });

  if (!req.file) {
    console.error("No file uploaded");
    const error = "Please upload an image file";

    if (req.headers.accept?.includes("application/json")) {
      return res.status(400).json({ success: false, error });
    }

    const html = await renderView("analyze", { error, result: null });
    return res.status(400).send(html);
  }

  try {
    console.log("Processing uploaded file:", {
      path: req.file.path,
      url: req.file.path,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    // Verify Cloudinary configuration
    console.log("Cloudinary config check:", {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? "set" : "missing",
      api_key: process.env.CLOUDINARY_API_KEY ? "set" : "missing",
      api_secret: process.env.CLOUDINARY_API_SECRET ? "set" : "missing",
    });

    // Verify Gemini API configuration
    console.log("Gemini API config check:", {
      api_key: process.env.GEMINI_API_KEY ? "set" : "missing",
    });

    // Get image data from Cloudinary URL
    console.log("Fetching image from:", req.file.path);
    const imageResponse = await fetch(req.file.path);
    if (!imageResponse.ok) {
      throw new Error(
        `Failed to fetch image from Cloudinary: ${imageResponse.status} ${imageResponse.statusText}`
      );
    }

    // Convert response to Buffer using arrayBuffer()
    const arrayBuffer = await imageResponse.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const base64Image = imageBuffer.toString("base64");
    console.log("Successfully converted image to base64");

    // Initialize Gemini model
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Gemini API key is not configured");
    }

    const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
    console.log("Initialized Gemini model");

    // Prepare the analysis prompt
    const analysisPrompt = {
      text:
        "Analyze this plant image and provide the following information in a clear, formatted way:\n" +
        "1. Plant Species/Name (both common and scientific names if possible)\n" +
        "2. Plant Health Assessment (look for signs of disease, nutrient deficiencies, or stress)\n" +
        "3. Care Instructions (watering, sunlight, soil, and temperature requirements)\n" +
        "4. Interesting Facts about this plant species",
    };

    console.log("Sending request to Gemini API");
    const result = await model.generateContent([
      analysisPrompt,
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: base64Image,
        },
      },
    ]);

    console.log("Received response from Gemini API");
    const response = await result.response;
    const analysis = response.text();

    console.log("Analysis completed successfully");

    if (req.headers.accept?.includes("application/json")) {
      return res.json({
        success: true,
        data: {
          imageUrl: req.file.path,
          analysis: analysis,
        },
      });
    }

    const html = await renderView("analyze", {
      error: null,
      result: {
        imageUrl: req.file.path,
        analysis: analysis,
      },
    });
    res.send(html);
  } catch (error) {
    console.error("Analysis error:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    const errorMessage = `Failed to analyze image: ${error.message}`;

    if (req.headers.accept?.includes("application/json")) {
      return res.status(500).json({
        success: false,
        error: errorMessage,
        details: error.stack,
      });
    }

    try {
      const html = await renderView("analyze", {
        error: errorMessage,
        result: null,
      });
      res.status(500).send(html);
    } catch (renderError) {
      console.error("Failed to render error page:", renderError);
      res.status(500).send("Failed to analyze image and render error page");
    }
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error("Global error:", err);

  // If it's a view rendering error, try to show an error page
  if (err.view) {
    renderView("error", { error: err })
      .then((html) => res.status(500).send(html))
      .catch(() => res.status(500).json({ error: "Server error" }));
  } else {
    res.status(500).json({
      success: false,
      error: "Server error",
      details: err.message,
    });
  }
});

// Create handler
const handler = serverless(app, {
  binary: ["image/*", "text/html"],
});

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
    // Handle the request
    const result = await handler(event, context);

    // Add CORS and content type headers
    const responseHeaders = {
      ...headers,
      ...result.headers,
      "Content-Type": result.headers?.["content-type"] || "text/html",
    };

    return {
      ...result,
      headers: responseHeaders,
    };
  } catch (error) {
    console.error("Handler error:", error);
    return {
      statusCode: 500,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Server error",
        details: error.message,
      }),
    };
  }
};
