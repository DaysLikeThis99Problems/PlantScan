const express = require("express");
const serverless = require("serverless-http");
const path = require("path");
const cookieParser = require("cookie-parser");

// Import the app but wrap in try-catch to handle potential errors
let app;
try {
  // Initialize express if app import fails
  const baseApp = express();

  // Essential middleware that might be needed before main app
  baseApp.use(express.json({ limit: "50mb" }));
  baseApp.use(express.urlencoded({ extended: true, limit: "50mb" }));
  baseApp.use(cookieParser());

  // Configure view engine for serverless environment
  baseApp.set("views", path.join(__dirname, "../../views"));
  baseApp.set("view engine", "ejs");

  // Import main app
  const mainApp = require("../../app");

  // Merge the apps
  app = mainApp || baseApp;
} catch (error) {
  console.error("Error importing app:", error);
  // Create a basic error app if main app fails to import
  app = express();
  app.use((req, res) => {
    res.status(500).json({
      error: "Server configuration error",
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  });
}

// Ensure essential middleware is present
if (!app._router) {
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(cookieParser());
}

// Add error handling middleware if not present
if (!app._router.stack.some((layer) => layer.name === "errorHandler")) {
  app.use((err, req, res, next) => {
    console.error("Express error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      details: process.env.NODE_ENV === "development" ? err.stack : undefined,
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
      }),
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
      },
    };
  }
};
