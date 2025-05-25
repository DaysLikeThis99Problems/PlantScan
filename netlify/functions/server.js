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
    // Check file type
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"), false);
    }

    // Check file extension
    const allowedExtensions = ["jpg", "jpeg", "png"];
    const extension = file.originalname.split(".").pop().toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      return cb(
        new Error("Only .jpg, .jpeg, and .png files are allowed"),
        false
      );
    }

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

// Import the app but wrap in try-catch to handle potential errors
let app;
try {
  // Initialize express if app import fails
  const baseApp = express();

  // Essential middleware that might be needed before main app
  baseApp.use(express.json({ limit: "50mb" }));
  baseApp.use(express.urlencoded({ extended: true, limit: "50mb" }));
  baseApp.use(cookieParser());

  // Resolve paths
  const viewsPath = resolvePath("views");
  const publicPath = resolvePath("public");

  console.log("Paths resolved:", {
    views: viewsPath,
    public: publicPath,
    cwd: process.cwd(),
    dirname: __dirname,
  });

  // Configure view engine and static files
  baseApp.set("views", viewsPath);
  baseApp.set("view engine", "ejs");
  baseApp.use(express.static(publicPath));

  // Import main app
  const mainApp = require("../../app");

  // Ensure paths are set correctly in the main app
  mainApp.set("views", viewsPath);
  mainApp.use(express.static(publicPath));

  // Add upload endpoints if they don't exist
  if (
    !mainApp._router.stack.some(
      (layer) => layer.route && layer.route.path === "/upload1"
    )
  ) {
    mainApp.post("/upload1", upload.single("image"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        console.log("File upload successful:", {
          path: req.file.path,
          filename: req.file.filename,
          mimetype: req.file.mimetype,
        });

        res.status(201).json({
          message: "Image uploaded successfully!",
          data: {
            url: req.file.path,
            public_id: req.file.filename,
          },
        });
      } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
          error: "Error uploading image",
          details: error.message,
        });
      }
    });
  }

  if (
    !mainApp._router.stack.some(
      (layer) => layer.route && layer.route.path === "/analyze"
    )
  ) {
    mainApp.post("/analyze", upload.single("image"), async (req, res) => {
      console.log("Analyze endpoint hit");

      try {
        // Check if file exists
        if (!req.file) {
          console.log("No file received");
          return res.status(400).json({
            success: false,
            error: "No file uploaded",
          });
        }

        console.log("File uploaded to Cloudinary:", {
          url: req.file.path,
          publicId: req.file.filename,
          format: req.file.format,
          size: req.file.size,
        });

        try {
          // Get the image data from Cloudinary URL
          console.log("Fetching image from Cloudinary for analysis...");
          const imageResponse = await fetch(req.file.path);
          if (!imageResponse.ok) {
            throw new Error(
              `Failed to fetch image: ${imageResponse.statusText}`
            );
          }

          const imageBuffer = await imageResponse.buffer();
          const base64Image = imageBuffer.toString("base64");

          // Analyze with Gemini
          console.log("Initializing Gemini analysis...");
          const model = genAI.getGenerativeModel({
            model: "gemini-pro-vision",
          });

          const prompt = [
            "Analyze this plant image and provide: \n1. Plant Species/Name\n2. Plant Health Assessment\n3. Care Instructions\n4. Interesting Facts",
            {
              inlineData: {
                mimeType: req.file.mimetype,
                data: base64Image,
              },
            },
          ];

          console.log("Sending to Gemini API...");
          const result = await model.generateContent(prompt);

          if (!result || !result.response) {
            throw new Error("Invalid response from Gemini API");
          }

          const analysis = result.response.text();
          console.log("Analysis received, length:", analysis.length);

          // Send successful response
          res.json({
            success: true,
            data: {
              analysis: analysis,
              image: {
                url: req.file.path,
                publicId: req.file.filename,
                format: req.file.format,
              },
            },
          });
        } catch (analysisError) {
          console.error("Analysis error:", analysisError);
          res.status(500).json({
            success: false,
            error: "Analysis failed",
            message: analysisError.message,
            type: "ANALYSIS_ERROR",
          });
        }
      } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({
          success: false,
          error: "Server error",
          message: error.message,
          type: "SERVER_ERROR",
        });
      }
    });
  }

  // Add a status check endpoint for the Gemini API
  if (
    !mainApp._router.stack.some(
      (layer) => layer.route && layer.route.path === "/api-status"
    )
  ) {
    mainApp.get("/api-status", async (req, res) => {
      try {
        console.log("Testing Gemini API connection...");
        const model = genAI.getGenerativeAI();
        const result = await model.generateContent("Test connection");
        const response = await result.response;

        res.json({
          status: "ok",
          geminiApi: "connected",
          message: response.text(),
        });
      } catch (error) {
        console.error("API Status check error:", error);
        res.status(500).json({
          status: "error",
          geminiApi: "disconnected",
          error: error.message,
        });
      }
    });
  }

  // Add a test endpoint for Gemini API
  if (
    !mainApp._router.stack.some(
      (layer) => layer.route && layer.route.path === "/test-gemini"
    )
  ) {
    mainApp.get("/test-gemini", async (req, res) => {
      try {
        const model = genAI.getGenerativeAI();
        const result = await model.generateContent(
          "Hello, test if Gemini API is working."
        );
        const response = await result.response;
        res.json({
          message: "Gemini API test successful",
          response: response.text(),
        });
      } catch (error) {
        console.error("Gemini API test error:", error);
        res.status(500).json({
          error: "Gemini API test failed",
          details: error.message,
        });
      }
    });
  }

  // Add test upload endpoint
  if (
    !mainApp._router.stack.some(
      (layer) => layer.route && layer.route.path === "/test-upload"
    )
  ) {
    mainApp.post("/test-upload", upload.single("image"), (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      res.json({
        success: true,
        file: {
          url: req.file.path,
          publicId: req.file.filename,
          format: req.file.format,
          size: req.file.size,
        },
      });
    });
  }

  // Merge the apps
  app = mainApp || baseApp;

  // Add path check middleware
  app.use((req, res, next) => {
    console.log("Request path:", req.path);
    console.log("Available views:", fs.readdirSync(viewsPath));
    if (req.path.startsWith("/images/")) {
      console.log("Checking image:", path.join(publicPath, req.path));
    }
    next();
  });

  // Override render to add debugging
  const originalRender = app.render.bind(app);
  app.render = function (name, options, callback) {
    console.log("Rendering view:", name);
    console.log("Views directory:", this.get("views"));
    console.log("View engine:", this.get("view engine"));
    return originalRender(name, options, callback);
  };

  // Add error handling for multer errors
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "File too large",
          details: "Maximum file size is 10MB",
        });
      }
      return res.status(400).json({
        error: "File upload error",
        details: error.message,
      });
    }
    next(error);
  });
} catch (error) {
  console.error("Error importing app:", error);
  app = express();
  app.use((req, res) => {
    res.status(500).json({
      error: "Server configuration error",
      details: error.message,
      paths: {
        cwd: process.cwd(),
        dirname: __dirname,
        views: resolvePath("views"),
        public: resolvePath("public"),
      },
    });
  });
}

// Ensure essential middleware is present
if (!app._router) {
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(cookieParser());
}

// Add view engine check middleware
app.use((req, res, next) => {
  const originalRender = res.render;
  res.render = function (view, options, callback) {
    console.log("Rendering view:", view);
    console.log("Views directory:", app.get("views"));
    console.log("Available views:", fs.readdirSync(app.get("views")));
    return originalRender.call(this, view, options, callback);
  };
  next();
});

// Add error handling middleware if not present
if (!app._router.stack.some((layer) => layer.name === "errorHandler")) {
  app.use((err, req, res, next) => {
    console.error("Express error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      viewsPath: app.get("views"),
    });
  });
}

// Configure serverless options
const handler = serverless(app, {
  binary: [
    "application/octet-stream",
    "application/pdf",
    "image/*",
    "font/*",
    "application/javascript",
    "text/css",
    "text/html",
    "application/json",
    "multipart/form-data",
  ],
  provider: "aws",
  basePath: "/.netlify/functions/server",
  request: {
    // Copy cookies to headers for compatibility
    processHeaders: (headers, event) => {
      if (event.cookies && event.cookies.length) {
        headers.cookie = event.cookies.join("; ");
      }
      if (event.multiValueHeaders && event.multiValueHeaders.Cookie) {
        headers.cookie = event.multiValueHeaders.Cookie.join("; ");
      }
      return headers;
    },
  },
});

// Export the handler
exports.handler = async (event, context) => {
  // Add error handling
  try {
    // Handle preflight requests
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Credentials": "true",
        },
      };
    }

    // Log request details in development
    if (process.env.NODE_ENV === "development") {
      console.log("Request:", {
        path: event.path,
        method: event.httpMethod,
        headers: event.headers,
        body: event.body ? JSON.parse(event.body) : undefined,
      });
    }

    // Process the request
    const response = await handler(event, context);

    // Handle binary responses
    if (event.path === "/download" || event.path === "/download-history") {
      response.headers = {
        ...response.headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=plant_analysis_${Date.now()}.pdf`,
      };
    }

    // Handle static files
    if (event.path.startsWith("/images/")) {
      const imagePath = resolvePath(path.join("public", event.path));
      console.log("Serving image from:", imagePath);
    }

    // Handle view responses
    if (
      response.headers &&
      response.headers["content-type"] &&
      response.headers["content-type"].includes("text/html")
    ) {
      response.headers["cache-control"] = "no-cache";
    }

    // Ensure CORS headers are set
    response.headers = {
      ...response.headers,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Credentials": "true",
    };

    // Log response in development
    if (process.env.NODE_ENV === "development") {
      console.log("Response:", {
        statusCode: response.statusCode,
        headers: response.headers,
      });
    }

    return response;
  } catch (error) {
    console.error("Function error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message,
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
        paths: {
          cwd: process.cwd(),
          dirname: __dirname,
          views: resolvePath("views"),
          public: resolvePath("public"),
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
      },
    };
  }
};
