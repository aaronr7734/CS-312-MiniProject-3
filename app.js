const express = require("express");
const app = express();
const path = require("path");
const expressEjsLayouts = require("express-ejs-layouts");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const pool = new Pool({
  user: "jar",
  host: "localhost",
  database: "blogdb",
  port: 5432,
});

app.use(expressEjsLayouts);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("layout", "./layout");

app.use(express.static(path.join(__dirname, "public"))); // Not currently being used, but we might later.
app.use(express.urlencoded({ extended: true }));

// Set up session middleware
app.use(
  session({
    secret: "Who_Needs_A_SECURE_KEY_ANYWAYS?_DEFINITELY_not_ME.",
    resave: false,
    saveUninitialized: false,
  })
);

const port = 3000;

// Helper function to truncate long strings.
function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + "..." : str;
}

// Middleware to check if user is authenticated
function checkAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/signin");
  }
}

// Routes

// Home Route
app.get("/", async (req, res) => {
  try {
    const blogsResult = await pool.query(`
      SELECT b.blog_id AS id, b.title, b.content, b.date_created AS "creationTime", b.creator_user_id, u.name AS author, c.category_name AS category
      FROM blogs b
      JOIN categories c ON b.category_id = c.category_id
      JOIN users u ON b.creator_user_id = u.user_id
      ORDER BY b.date_created DESC
    `);
    const blogs = blogsResult.rows;

    const categoriesResult = await pool.query(
      "SELECT category_name AS category FROM categories ORDER BY category_name"
    );
    const categories = categoriesResult.rows.map((row) => row.category);

    res.render("home", {
      blogPosts: blogs,
      categories: categories,
      user: req.session.user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Sign Up Route
app.get("/signup", (req, res) => {
  res.render("signup", { user: req.session.user });
});

app.post("/signup", async (req, res) => {
  const { user_id, name, password } = req.body;
  try {
    // Check if user_id already exists
    const userResult = await pool.query(
      "SELECT * FROM users WHERE user_id = $1",
      [user_id]
    );
    if (userResult.rows.length > 0) {
      res.send("User ID already taken. Please choose a different one.");
    } else {
      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);
      // Insert new user
      await pool.query(
        "INSERT INTO users (user_id, name, password) VALUES ($1, $2, $3)",
        [user_id, name, hashedPassword]
      );
      res.redirect("/signin");
    }
  } catch (err) {
    console.error("Error signing up:", err);
    res.status(500).send("Server error");
  }
});

// Sign In Route
app.get("/signin", (req, res) => {
  res.render("signin", { user: req.session.user });
});

app.post("/signin", async (req, res) => {
  const { user_id, password } = req.body;
  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE user_id = $1",
      [user_id]
    );
    if (userResult.rows.length === 0) {
      res.send("User ID not found.");
    } else {
      const user = userResult.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        // Store user information in session
        req.session.user = {
          user_id: user.user_id,
          name: user.name,
        };
        res.redirect("/");
      } else {
        res.send("Incorrect password.");
      }
    }
  } catch (err) {
    console.error("Error signing in:", err);
    res.status(500).send("Server error");
  }
});

// Sign Out Route
app.get("/signout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error signing out:", err);
    }
    res.redirect("/");
  });
});

// Create Post form (accessible only to authenticated users)
app.get("/create-post", checkAuthenticated, async (req, res) => {
  try {
    const categoriesResult = await pool.query(
      "SELECT category_name AS category FROM categories ORDER BY category_name"
    );
    const categories = categoriesResult.rows.map((row) => row.category);
    res.render("create-post", {
      categories: categories,
      user: req.session.user,
    });
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).send("Server error");
  }
});

// Create post route
app.post("/create-post", checkAuthenticated, async (req, res) => {
  console.log("Received form data:", req.body);
  const { title, content, category, newCategory } = req.body;
  const author = req.session.user.name;
  const creator_user_id = req.session.user.user_id;

  // Determine the category name to use
  const categoryName = category === "new" ? newCategory : category;

  await createBlogPost(title, author, categoryName, content, creator_user_id);
  res.redirect("/"); // Return to homepage after creating post.
});

// Edit post form route (accessible only to post creator)
app.get("/edit/:id", checkAuthenticated, async (req, res) => {
  const postId = req.params.id;
  try {
    // Fetch the post
    const postResult = await pool.query(
      `
      SELECT b.blog_id AS id, b.title, b.content, b.date_created AS "creationTime", u.name AS author, c.category_name AS category, b.creator_user_id
      FROM blogs b
      JOIN categories c ON b.category_id = c.category_id
      JOIN users u ON b.creator_user_id = u.user_id
      WHERE b.blog_id = $1
    `,
      [postId]
    );

    if (postResult.rows.length === 0) {
      res.status(404).send("Post not found");
      return;
    }
    const post = postResult.rows[0];

    // Ensure the logged-in user is the creator
    if (post.creator_user_id !== req.session.user.user_id) {
      res.status(403).send("You are not authorized to edit this post.");
      return;
    }

    // Fetch categories
    const categoriesResult = await pool.query(
      "SELECT category_name AS category FROM categories ORDER BY category_name"
    );
    const categories = categoriesResult.rows.map((row) => row.category);

    res.render("edit-post", {
      post: post,
      categories: categories,
      user: req.session.user,
    });
  } catch (err) {
    console.error("Error fetching post:", err);
    res.status(500).send("Server error");
  }
});

// Update post route (used after submitting the edit form)
app.post("/edit/:id", checkAuthenticated, async (req, res) => {
  const postId = req.params.id;
  const { title, content, category, newCategory } = req.body;

  // Determine the category name to use
  const categoryName = category === "new" ? newCategory : category;

  await editPost(
    postId,
    title,
    content,
    categoryName,
    req.session.user.user_id
  );
  res.redirect("/");
});

// Delete post route (accessible only to post creator)
app.post("/delete/:id", checkAuthenticated, async (req, res) => {
  const postId = req.params.id;
  try {
    // Check if the post belongs to the logged-in user
    const postResult = await pool.query(
      "SELECT creator_user_id FROM blogs WHERE blog_id = $1",
      [postId]
    );

    if (postResult.rows.length === 0) {
      res.status(404).send("Post not found.");
      return;
    }

    const post = postResult.rows[0];

    if (post.creator_user_id !== req.session.user.user_id) {
      res.status(403).send("You are not authorized to delete this post.");
      return;
    }

    const deleteResult = await pool.query(
      "DELETE FROM blogs WHERE blog_id = $1",
      [postId]
    );
    if (deleteResult.rowCount > 0) {
      console.log(`🗑️ Post deleted! ID: ${postId}`);
    } else {
      console.log(`Post with ID ${postId} not found.`);
    }
    res.redirect("/");
  } catch (err) {
    console.error("Error deleting post:", err);
    res.status(500).send("Server error");
  }
});

// Helper functions
async function createBlogPost(
  title,
  author,
  categoryName,
  content,
  creator_user_id
) {
  try {
    // Check if category exists
    const categoryResult = await pool.query(
      "SELECT category_id FROM categories WHERE category_name = $1",
      [categoryName]
    );
    let categoryId;
    if (categoryResult.rows.length > 0) {
      categoryId = categoryResult.rows[0].category_id;
    } else {
      // Add new category
      const insertCategoryResult = await pool.query(
        "INSERT INTO categories (category_name) VALUES ($1) RETURNING category_id",
        [categoryName]
      );
      categoryId = insertCategoryResult.rows[0].category_id;
    }

    // Insert new blog post
    const insertBlogResult = await pool.query(
      "INSERT INTO blogs (creator_user_id, creator_name, title, content, category_id) VALUES ($1, $2, $3, $4, $5) RETURNING blog_id",
      [creator_user_id, author, title, content, categoryId]
    );
    const newBlogId = insertBlogResult.rows[0].blog_id;

    console.log(`New post created!
      ID: ${newBlogId}
      Title: ${truncate(title, 100)}
      Author: ${author}
      Category: ${categoryName}
      Content preview: ${truncate(content, 250)}`);

    return { id: newBlogId, title, author, category: categoryName, content };
  } catch (err) {
    console.error("Error creating blog post:", err);
  }
}

async function editPost(postId, newTitle, newContent, newCategory, userId) {
  try {
    // Check if the post belongs to the logged-in user
    const postResult = await pool.query(
      "SELECT creator_user_id FROM blogs WHERE blog_id = $1",
      [postId]
    );

    if (postResult.rows.length === 0) {
      console.log(`Post with ID ${postId} not found!`);
      return;
    }

    const post = postResult.rows[0];

    if (post.creator_user_id !== userId) {
      console.log("Unauthorized edit attempt.");
      return;
    }

    // Check if the category exists
    const categoryResult = await pool.query(
      "SELECT category_id FROM categories WHERE category_name = $1",
      [newCategory]
    );
    let categoryId;
    if (categoryResult.rows.length > 0) {
      categoryId = categoryResult.rows[0].category_id;
    } else {
      // Add new category
      const insertCategoryResult = await pool.query(
        "INSERT INTO categories (category_name) VALUES ($1) RETURNING category_id",
        [newCategory]
      );
      categoryId = insertCategoryResult.rows[0].category_id;
    }

    // Update the post
    const updateResult = await pool.query(
      `
      UPDATE blogs
      SET title = $1, content = $2, category_id = $3
      WHERE blog_id = $4
      RETURNING *
    `,
      [newTitle, newContent, categoryId, postId]
    );

    if (updateResult.rows.length === 0) {
      console.log(`Post with ID ${postId} not found!`);
      return;
    }

    console.log(`Post edited!
          ID: ${postId}
          Title: ${truncate(newTitle, 100)}
          Content: ${truncate(newContent, 250)}
          Category ID: ${categoryId}`);
  } catch (err) {
    console.error("Error editing post:", err);
  }
}

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
