const express = require("express");
const serverless = require("serverless-http");
const path = require("path");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

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
    folder: "images-folder",
    allowed_formats: ["jpg", "jpeg", "png", "gif"],
    transformation: [{ width: 800, height: 600, crop: "fill" }],
  },
});

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
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
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        console.log("File received for analysis:", {
          path: req.file.path,
          filename: req.file.filename,
          mimetype: req.file.mimetype,
        });

        // Get the image data from Cloudinary URL
        const imageResponse = await fetch(req.file.path);
        const imageBuffer = await imageResponse.buffer();
        const imageData = imageBuffer.toString("base64");

        res.json({
          message: "Image received for analysis",
          image: `data:${req.file.mimetype};base64,${imageData}`,
        });
      } catch (error) {
        console.error("Analysis error:", error);
        res.status(500).json({
          error: "Error processing image",
          details: error.message,
        });
      }
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
