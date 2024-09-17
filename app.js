const express = require("express");
const app = express();
const path = require("path");
const expressEjsLayouts = require("express-ejs-layouts");
const { secureHeapUsed } = require("crypto");
app.use(expressEjsLayouts);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("layout", "./layout");

app.use(express.static(path.join(__dirname, "public"))); // Not currently being used, but we might later.
app.use(express.urlencoded({ extended: true }));

const port = 3000;
// Array to hold our posts.
let blogPosts = [];

// Array of categories
let categories = [
  "Technology",
  "Science",
  "Politics",
  "Pop Culture",
  "World News",
];

// Back-end Functions for blog management:
function addCategory(newCategory) {
  if (!categories.includes(newCategory)) {
    categories.push(newCategory);
    console.log(`New category created: ${newCategory}`);
    return true; // Category added successfully.
  }
  console.log(`Category "${newCategory}" already exists!`);
  return false; // Category already exists.
}

function createBlogPost(title, author, category, content) {
  // If the category doesn't exist, add it.
  if (!categories.includes(category)) {
    addCategory(category);
  }

  const newPost = {
    id: Date.now().toString(),
    title: title,
    creationTime: new Date(),
    author: author,
    category: category,
    content: content,
  };
  blogPosts.push(newPost);

  console.log(` New post created!
    ID: ${newPost.id}
    Title: ${truncate(newPost.title, 100)}
    Author: ${newPost.author}
    Category: ${newPost.category}
    Content preview: ${truncate(newPost.content, 250)}`);
  return newPost;
}

function editPost(postId, newTitle, newContent, newCategory) {
  const postToEdit = blogPosts.find((post) => post.id === postId);
  if (postToEdit) {
    const changes = [];
    if (postToEdit.title !== newTitle) {
      changes.push(`Title changed to: ${truncate(newTitle, 100)}`);
      postToEdit.title = newTitle;
    }
    if (postToEdit.content !== newContent) {
      changes.push(`Content updated: ${truncate(newContent, 250)}`);
      postToEdit.content = newContent;
    }
    if (postToEdit.category !== newCategory) {
      changes.push(`Category changed to: ${newCategory}`);
      postToEdit.category = newCategory;
    }
    postToEdit.lastModified = new Date();

    console.log(`Post edited!
        ID: ${postId}
        ${changes.join("\n      ")}`);
  } else {
    console.log(`Post with ID ${postId} not found!`);
  }
}

// Helper function to trunkate long strings.
function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + "..." : str;
}

// Routes

// Home Route
app.get("/", (req, res) => {
  res.render("home", { blogPosts: blogPosts, categories: categories });
});

// Create Post form
app.get("/create-post", (req, res) => {
  res.render("create-post", { categories: categories });
});

// create post route
app.post("/create-post", (req, res) => {
  console.log("Received form data:", req.body);
  const { title, author, content, category } = req.body;
  const newPost = createBlogPost(title, author, category, content);
  res.redirect("/"); // Return to homepage after creating post.
});

// Edit post form route
app.get("/edit/:id", (req, res) => {
  const post = blogPosts.find((post) => post.id === req.params.id);
  if (post) {
    res.render("edit-post", { post: post, categories: categories });
  } else {
    res.status(404).send("Post not found");
  }
});

// Update post route (used after submitting the edit form.)
app.post("/edit/:id", (req, res) => {
  const { title, content, category } = req.body;
  editPost(req.params.id, title, content, category);
  res.redirect("/");
});

// Delete post route
app.post("/delete/:id", (req, res) => {
  const index = blogPosts.findIndex((post) => post.id === req.params.id);
  if (index !== -1) {
    blogPosts.splice(index, 1);
    console.log(`🗑️ Post deleted! ID: ${req.params.id}`);
  }
  res.redirect("/");
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).send("Sorry, that page doesn't exist!");
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something appears to have broken! OOPS!");
});

app.listen(port, () => {
  console.log(`Aaronblog is listening at http://localhost:${port}`);
});
