const mongoose = require("mongoose");

// Image schema for embedded documents
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

// User schema
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
      default: "/images/default-avatar.jpg",
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

// Create the model
const User = mongoose.model("User", userSchema);

module.exports = User;
