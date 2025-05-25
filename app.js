require("dotenv").config();
const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();

// Security middleware
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something broke!" });
});

// Configure middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files middleware
app.use(express.static("public"));

// Set view engine and views directory
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const port = process.env.PORT || 3000;

// MongoDB connection with retry logic
const connectWithRetry = async (retries = 5, interval = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(process.env.MONGODB_URL, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
      });
      console.log("✅ MongoDB connected successfully");
      return;
    } catch (error) {
      console.error(
        `❌ Attempt ${i + 1} failed. Error connecting to MongoDB:`,
        error.message
      );
      if (i < retries - 1) {
        console.log(`Retrying in ${interval / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }
  }
  throw new Error("Failed to connect to MongoDB after multiple attempts");
};

// Initialize MongoDB connection
connectWithRetry().catch((error) => {
  console.error("Fatal MongoDB connection error:", error);
  process.exit(1);
});

//Post
const postSchema = new mongoose.Schema(
  {
    url: String,
    public_id: String,
    username: String,
    date: Date,
  },
  {
    timestamps: true,
  }
);
const Post = mongoose.model("Post", postSchema);
//Image schema
const imageSchema = new mongoose.Schema(
  {
    url: String,
    public_id: String,
    plantType: {
      type: String,
      default: "Unknown",
    },
    analysis: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);
//Model
const Image = mongoose.model("Image", imageSchema);
//Create the userSchema
const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      unique: true,
      required: true,
    },
    password: String,
    displayName: {
      type: String,
      default: function () {
        return this.username;
      },
    },
    profilePicture: {
      type: String,
      default: "/images/default-avatar.jpg", // Using a person emoji as default
    },
    email: String,
    role: {
      type: String,
      default: "user",
    },
    posts: [imageSchema],
  },
  {
    timestamps: true,
  }
);
//Compile the schema to form model
const User = mongoose.model("User", userSchema);

//!Middlewares
//!-isAuthenticated (Authentication)
const isAuthenticated = (req, res, next) => {
  //Check the user in the cookies
  const userDataCookie = req.cookies.userData;
  try {
    const userData = userDataCookie && JSON.parse(userDataCookie);
    if (userData && userData.username) {
      //!Add the login user into the req object
      req.userData = userData;
      return next();
    } else {
      res.send("You are not login");
    }
  } catch (error) {
    console.log(error);
  }
};
//!-isAdmin (Authorization)
const isAdmin = (req, res, next) => {
  if (req.userData && req.userData.role === "user") {
    return next();
  } else {
    res.send("Fobidden: You do not have access, admin only");
  }
};

//Login Route (login form)
app.get("/login", (req, res) => {
  res.render("login");
});
//Register Route (register form)
app.get("/register", (req, res) => {
  res.render("register");
});

//Register Logic (register form)
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with displayName same as username
    const user = await User.create({
      username,
      password: hashedPassword,
      displayName: username, // Explicitly set displayName to username
      profilePicture: "👤", // Using emoji as default profile picture
    });

    res.redirect("/login");
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).send("Error during registration");
  }
});


//Login Route logic
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  //!. Find the user in the db
  const userFound = await User.findOne({
    username,
  });
  if (userFound && (await bcrypt.compare(password, userFound.password))) {
    //! Create some cookies (cookie);
    //* Prepare the login user data
    //? Setting the cookie with the userdata
    res.cookie(
      "userData",
      JSON.stringify({
        username: userFound.username,
        displayName: userFound.displayName || userFound.username,
        role: userFound.role,
      }),
      {
        maxAge: 3 * 24 * 60 * 1000, //3days expiration
        httpOnly: true,
        secure: false,
        sameSite: "strict",
      }
    );
    res.redirect("/dashboard");
  } else {
    res.send("Invalid login credentials");
  }
});
// //Login Route logic
// app.post("/login", async (req, res) => {
//   try {
//     const { username, password } = req.body;

//     console.log("Login attempt for username:", username);

//     if (!username || !password) {
//       return res.status(400).send("Username and password are required");
//     }

//     //Find the user in the db
//     const userFound = await User.findOne({ username });

//     if (!userFound) {
//       console.log("User not found:", username);
//       return res.status(401).send("Invalid login credentials");
//     }

//     const isPasswordValid = await bcrypt.compare(password, userFound.password);

//     if (!isPasswordValid) {
//       console.log("Invalid password for user:", username);
//       return res.status(401).send("Invalid login credentials");
//     }

//     // Create cookie with user data
//     res.cookie(
//       "userData",
//       JSON.stringify({
//         username: userFound.username,
//         displayName: userFound.displayName || userFound.username,
//         role: userFound.role,
//       }),
//       {
//         maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days expiration
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: "strict",
//       }
//     );

//     console.log("Successful login for user:", username);
//     res.redirect("/dashboard");
//   } catch (error) {
//     console.error("Login error:", error);
//     res.status(500).send("An error occurred during login");
//   }
// });

//Dashboard Route
app.get("/dashboard", isAuthenticated, isAdmin, async (req, res) => {
  try {
    //! Grab the user from the cookie
    const userData = req.cookies.userData
      ? JSON.parse(req.cookies.userData)
      : null;
    const username = userData ? userData.username : null;

    if (!username) {
      return res.redirect("/login");
    }

    // Get full user data from database
    const user = await User.findOne({ username });
    if (!user) {
      res.clearCookie("userData");
      return res.redirect("/login");
    }

    //! Render the template with user data
    res.render("dashboard", {
      username: user.username,
      displayName: user.displayName || user.username,
      profilePicture: user.profilePicture || "👤",
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).send("Error loading dashboard");
  }
});

//Logout Route
app.get("/logout", (req, res) => {
  //!Logout
  res.clearCookie("userData");
  //redirect
  res.redirect("/login");
});

//
//
//
//
//Configure cloudinary
cloudinary.config({
  api_key: process.env.CLOUDINARY_API_KEY,
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

//Configure multer storage cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "images-folder",
    format: async (req, file) => "png",
    public_id: (req, file) => file.fieldname + "_" + Date.now(),
    transformation: [
      {
        width: 800,
        height: 600,
        crop: "fill",
      },
    ],
  },
});

// Main upload middleware for image analysis
const uploadMiddleware = multer({
  storage,
  limits: 1024 * 1020 * 10, //10MB limit
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Not an image! Please upload an image", false));
    }
  },
});

// Profile picture upload middleware
const profilePictureUpload = multer({
  storage, // Use the same Cloudinary storage
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
}).single("profilePicture");

//initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

//routes
app.post("/upload1", uploadMiddleware.single("image"), async (req, res) => {
  try {
    const uploaded = await Image.create({
      url: req.file.path,
      public_id: req.file.filename,
    });

    // Ensure userId is passed correctly
    req.userData = JSON.parse(req.cookies.userData);
    const username = req.userData.username;
    if (!username) {
      return res.status(400).json({ error: "Username not found!" });
    }

    // Create image object (embedded document)
    const uploadedImage = {
      url: req.file.path,
      public_id: req.file.filename,
      plantType: req.body.plantType || "Unknown",
      analysis: req.body.analysis || "",
    };

    // Update user by adding the new image to the `posts` array
    const updatedUser = await User.findOneAndUpdate(
      { username },
      { $push: { posts: uploadedImage } },
      { new: true }
    );

    res.status(201).json({
      message: "Image uploaded successfully!",
      data: uploaded,
    });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: "Error uploading image" });
  }
});

app.get("/username", (req, res) => {
  req.userData = JSON.parse(req.cookies.userData);
  req.username = req.userData.username;
  res.json({ username: req.username });
});

app.post("/analyze", uploadMiddleware.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    console.log("File uploaded:", {
      path: req.file.path,
      mimetype: req.file.mimetype,
    });

    // Get image data from Cloudinary URL
    const imageResponse = await fetch(req.file.path);
    if (!imageResponse.ok) {
      throw new Error(
        `Failed to fetch image from Cloudinary: ${imageResponse.status} ${imageResponse.statusText}`
      );
    }

    // Convert the image data to base64
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageData = Buffer.from(imageBuffer).toString("base64");

    // Use the Gemini model to analyze the image
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent([
      "Analyze this plant image and provide detailed analysis of its species, health, and care recommendations, its characteristics, care instructions, and any interesting facts. Please provide the response in plain text without using any markdown formatting.",
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: imageData,
        },
      },
    ]);

    const plantInfo = result.response.text();

    // For debugging
    console.log(
      "Analysis completed. Sending response with image URL:",
      req.file.path
    );

    // Respond with the analysis result and the Cloudinary URL directly
    res.json({
      result: plantInfo,
      image: req.file.path, // Use the Cloudinary URL directly instead of base64
    });
  } catch (error) {
    console.error("Error analyzing image:", error);
    res.status(500).json({
      error: "An error occurred while analyzing the image",
      details: error.message,
    });
  }
});

//download pdf
app.post("/download", async (req, res) => {
  try {
    const { result, image } = req.body;

    // Create PDF document
    const doc = new PDFDocument();

    // Set up response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=plant_analysis_report_${Date.now()}.pdf`
    );

    // Pipe the PDF to the response
    doc.pipe(res);

    // Add content to the PDF
    doc.fontSize(24).text("Plant Analysis Report", {
      align: "center",
    });
    doc.moveDown();
    doc.fontSize(16).text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    doc.fontSize(14).text(result, { align: "left" });
    doc.moveDown();

    try {
      if (image) {
        // If image is a URL (Cloudinary)
        if (image.startsWith("http")) {
          // Fetch the image
          const imageResponse = await fetch(image);
          if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.status}`);
          }
          const imageBuffer = await imageResponse.arrayBuffer();

          // Add image to PDF
          doc.image(Buffer.from(imageBuffer), {
            fit: [500, 300],
            align: "center",
            valign: "center",
          });
        }
        // If image is base64
        else if (image.startsWith("data:image")) {
          const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
          const imageBuffer = Buffer.from(base64Data, "base64");

          doc.image(imageBuffer, {
            fit: [500, 300],
            align: "center",
            valign: "center",
          });
        }
      }
    } catch (imageError) {
      console.error("Error adding image to PDF:", imageError);
      // Continue without the image if there's an error
      doc
        .moveDown()
        .fontSize(12)
        .text("Note: Could not include image in the PDF", { italic: true });
    }

    // Finalize PDF file
    doc.end();
  } catch (error) {
    console.error("Error generating PDF report:", error);
    // Make sure we haven't started sending the response
    if (!res.headersSent) {
      res.status(500).json({
        error: "An error occurred while generating the PDF report",
        details: error.message,
      });
    }
  }
});

//Get all images for current user
app.get("/my-images", isAuthenticated, async (req, res) => {
  try {
    const username = req.userData.username;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ images: user.posts });
  } catch (error) {
    console.error("Error fetching images:", error);
    res.status(500).json({ error: "Error fetching images" });
  }
});

// Get user statistics
app.get("/user-stats", isAuthenticated, async (req, res) => {
  try {
    const username = req.userData.username;
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Calculate statistics
    const totalScans = user.posts.length;
    const lastScan =
      user.posts.length > 0
        ? user.posts[user.posts.length - 1].createdAt
        : null;

    // Get unique plant types (you might want to store plant type in your schema)
    const uniquePlantTypes = new Set(
      user.posts.map((post) => post.plantType || "Unknown")
    ).size;

    res.json({
      totalScans,
      lastScan,
      uniquePlantTypes,
    });
  } catch (error) {
    console.error("Error fetching user stats:", error);
    res.status(500).json({ error: "Error fetching user statistics" });
  }
});

// Download user history
app.get("/download-history", isAuthenticated, async (req, res) => {
  try {
    const username = req.userData.username;
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=plant_analysis_history_${Date.now()}.pdf`
    );

    // Create PDF document and pipe directly to response
    const doc = new PDFDocument();
    doc.pipe(res);

    // Add content to PDF
    doc.fontSize(24).text("Plant Analysis History", {
      align: "center",
    });
    doc.moveDown();
    doc.fontSize(16).text(`User: ${username}`);
    doc.moveDown();
    doc.fontSize(14).text(`Generated on: ${new Date().toLocaleDateString()}`);
    doc.moveDown().moveDown();

    // Add history entries
    if (user.posts.length > 0) {
      user.posts.forEach((post, index) => {
        doc.fontSize(14).text(`Scan ${index + 1}`, { underline: true });
        doc
          .fontSize(12)
          .text(`Date: ${new Date(post.createdAt).toLocaleString()}`);
        doc.text(`Image URL: ${post.url}`);
        if (post.plantType) {
          doc.text(`Plant Type: ${post.plantType}`);
        }
        doc.moveDown();
      });
    } else {
      doc.fontSize(12).text("No scans found in history.");
    }

    // Finalize PDF file
    doc.end();
  } catch (error) {
    console.error("Error generating history:", error);
    res.status(500).json({ error: "Error generating history" });
  }
});

// Delete image route
app.delete("/delete-image", isAuthenticated, async (req, res) => {
  try {
    const { public_id } = req.body;
    const username = req.userData.username;

    // Delete from Cloudinary
    await cloudinary.uploader.destroy(public_id);

    // Remove from user's posts array
    await User.findOneAndUpdate(
      { username },
      { $pull: { posts: { public_id: public_id } } }
    );

    res.json({ message: "Image deleted successfully" });
  } catch (error) {
    console.error("Error deleting image:", error);
    res.status(500).json({ error: "Failed to delete image" });
  }
});

// Get user profile
app.get("/user-profile", isAuthenticated, async (req, res) => {
  try {
    const username = req.userData.username;
    const user = await User.findOne({ username }).select(
      "username displayName email posts"
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      username: user.username,
      name: user.displayName || user.username,
      email: user.email,
      totalImages: user.posts.length,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ error: "Error fetching user profile" });
  }
});

// Add this route to update plant name
app.post("/update-plant-name", isAuthenticated, async (req, res) => {
  try {
    const { imageId, newName } = req.body;
    const username = req.userData.username;

    const user = await User.findOneAndUpdate(
      {
        username,
        "posts._id": imageId,
      },
      {
        $set: {
          "posts.$.plantType": newName,
        },
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: "Image not found" });
    }

    res.json({ success: true, message: "Plant name updated successfully" });
  } catch (error) {
    console.error("Error updating plant name:", error);
    res.status(500).json({ error: "Error updating plant name" });
  }
});

// Update profile route
app.post("/update-profile", isAuthenticated, (req, res) => {
  profilePictureUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const username = req.userData.username;
      const displayName = req.body.displayName;

      // Validate display name
      if (!displayName || displayName.trim().length < 2) {
        return res
          .status(400)
          .json({ error: "Display name must be at least 2 characters long" });
      }

      let updateData = {
        displayName: displayName.trim(),
      };

      // Handle profile picture upload
      if (req.file) {
        try {
          // Convert buffer to base64
          const base64Image = req.file.buffer.toString("base64");
          const uploadResult = await cloudinary.uploader.upload(
            `data:${req.file.mimetype};base64,${base64Image}`,
            {
              folder: "profile_pictures",
              transformation: [
                { width: 250, height: 250, crop: "fill" },
                { quality: "auto" },
              ],
            }
          );
          updateData.profilePicture = uploadResult.secure_url;
        } catch (uploadError) {
          console.error("Error uploading profile picture:", uploadError);
          return res
            .status(500)
            .json({ error: "Error uploading profile picture" });
        }
      }

      // Update user in database with upsert option
      const updatedUser = await User.findOneAndUpdate(
        { username: username }, // query
        { $set: updateData }, // update with $set operator
        {
          new: true, // return updated doc
          runValidators: true, // run schema validators
          upsert: false, // don't create if not exists
        }
      ).select("username displayName profilePicture");

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Log the update for debugging
      console.log("Profile updated:", {
        username,
        displayName: updatedUser.displayName,
        profilePicture: updatedUser.profilePicture,
      });

      // Update session data
      const userData = {
        ...req.userData,
        displayName: updatedUser.displayName,
      };

      res.cookie("userData", JSON.stringify(userData), {
        maxAge: 3 * 24 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: "strict",
      });

      res.json({
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ error: "Error updating profile" });
    }
  });
});

// Get user profile data
app.get("/user-profile-data", isAuthenticated, async (req, res) => {
  try {
    const username = req.userData.username;
    const user = await User.findOne({ username }).select(
      "username displayName profilePicture"
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Send response with defaults if needed
    res.json({
      username: user.username,
      displayName: user.displayName || user.username,
      profilePicture: user.profilePicture || "/images/default-avatar.png",
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ error: "Error fetching user profile" });
  }
});

// Error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Graceful shutdown
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error);
  // Graceful shutdown
  process.exit(1);
});

// Start server only if running directly
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

// Export the Express app
module.exports = app;
