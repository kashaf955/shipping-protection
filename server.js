import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import checkoutRoutes from "./routes/checkout.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : null;

app.use(
  cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve widget script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.get("/widget.js", (req, res) => {
  try {
    const widgetPath = join(__dirname, "shipping-insurance-widget.js");
    const widgetCode = readFileSync(widgetPath, "utf-8");
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
    res.send(widgetCode);
  } catch (error) {
    console.error("Error serving widget:", error);
    res.status(500).send("/* Widget file not found */");
  }
});

// Routes
app.use("/api/checkout", checkoutRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "BigCommerce API Server",
    endpoints: {
      health: "/health",
      getCheckout: "GET /api/checkout/:checkoutId",
      addInsuranceFee: "POST /api/checkout/:checkoutId/fee",
      test: "POST /api/checkout/test",
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(err.status || 500).json({
    success: false,
    error: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
