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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true,limit: "50mb" }));
const port = process.env.PORT || 3000;

//Connect to mongoose
const URL=""
//connect to mongodb
const connectToDB=async()=>{
    try{
        await mongoose.connect(URL);
        console.log("MongoDB connected successfully");
    }catch(error){
        console.log("Error connecting to mongodb"+error);
    }
}
//call the function
connectToDB();

//Post
const postSchema=new mongoose.Schema(
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
  },
  {
    timestamps: true,
  }
);
//Model
const Image = mongoose.model("Image", imageSchema);
//Create the userSchema
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: {
    type: String,
    default: "user",
  },
  posts: [imageSchema],
});
//Compile the schema to form model
const User = mongoose.model("User", userSchema);

//!Middlewares
//!Set the view engine
app.set("view engine", "ejs");
app.use(cookieParser());
//!--isAuthenticated (Authentication)
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
  //!Destructure the req.body
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  await User.create({
    username,
    password: hashedPassword,
  });
  //Redirect to login
  res.redirect("/login");
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

//Dashboard Route
app.get("/dashboard", isAuthenticated, isAdmin, (req, res) => {
  //! Grab the user from the cookie
  const userData = req.cookies.userData
    ? JSON.parse(req.cookies.userData)
    : null;
  const username = userData ? userData.username : null;
  //! Render the template
  if (username) {
    res.render("dashboard", { username });
  } else {
    //!Redirect to login
    res.redirect("/login");
  }
  console.log(username);
  const user = User.findOne({ username });
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
//configure multer
const upload = multer({ dest: "upload/" });
//=====upload file to cloud

//Configure cloudinary
cloudinary.config({
  api_key: process.env.CLOUDINARY_API_KEY,
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
//Configure milter storage cloudinary
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
const upload1 = multer({
  storage,
  limits: 1024 * 1020 * 10, //25MB limit
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Not an image! Please upload an image", false));
    }
  },
});

//initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
app.use(express.static("public"));

//routes
app.post("/upload1", upload1.single("image"), async (req, res) => {
    const uploaded = await Image.create({
      url: req.file.path,
      public_id: req.file.filename,
    });
    // Ensure userId is passed correctly
    req.userData=JSON.parse(req.cookies.userData);
    const username = req.userData.username;
    if (!username) {
      return res.status(400).json({ error: "Username not found!" });
    }
    // Create image object (embedded document)
    const uploadedImage = {
      url: req.file.path,
      public_id: req.file.filename,
    };
    // Update user by adding the new image to the `posts` array
    const updatedUser = await User.findOneAndUpdate(
      { username },
      { $push: { posts: uploadedImage } },
      { new: true }
    );
    res.status(201).json({ message: "Image uploaded successfully!", data: uploaded }); 
});

app.get('/username', (req, res) => {
  req.userData=JSON.parse(req.cookies.userData);
  req.username = req.userData.username;
  res.json({ username: req.username });
});

app.post("/analyze", upload.single("image"),async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    const imagePath = req.file.path;
    const imageData = await fsPromises.readFile(imagePath, {
      encoding: "base64",
    });

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

    // Clean up: delete the uploaded file
    await fsPromises.unlink(imagePath);

    // Respond with the analysis result and the image data
    res.json({
      result: plantInfo,
      image: `data:${req.file.mimetype};base64,${imageData}`,
    });
  } catch (error) {
    console.error("Error analyzing image:", error);
    res
      .status(500)
      .json({ error: "An error occurred while analyzing the image" });
  }
});

//download pdf
app.post("/download", async (req, res) => {
  const { result, image } = req.body;
  try {
    //Ensure the reports directory exists
    const reportsDir = path.join(__dirname, "reports");
    await fsPromises.mkdir(reportsDir, { recursive: true });
    //generate pdf
    const filename = `plant_analysis_report_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, filename);
    const writeStream = fs.createWriteStream(filePath);
    const doc = new PDFDocument();
    doc.pipe(writeStream);
    // Add content to the PDF
    doc.fontSize(24).text("Plant Analysis Report", {
      align: "center",
    });
    doc.moveDown();
    doc.fontSize(24).text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    doc.fontSize(14).text(result, { align: "left" });
    //insert image to the pdf
    if (image) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      doc.moveDown();
      doc.image(buffer, {
        fit: [500, 300],
        align: "center",
        valign: "center",
      });
    }
    doc.end();
    //wait for the pdf to be created
    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
    res.download(filePath, (err) => {
      if (err) {
        res.status(500).json({ error: "Error downloading the PDF report" });
      }
      fsPromises.unlink(filePath);
    });
  } catch (error) {
    console.error("Error generating PDF report:", error);
    res
      .status(500)
      .json({ error: "An error occurred while generating the PDF report" });
  }
});
//start the server
app.listen(port, () => {
  console.log(`server is live on: http://localhost:3000`);
});
