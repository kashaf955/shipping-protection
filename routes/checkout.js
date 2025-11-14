import express from "express";
import {
  getCheckout,
  toggleShippingInsuranceFee,
} from "../utils/bigCommerceApi.js";

const router = express.Router();

// Get checkout details
router.get("/:checkoutId", async (req, res, next) => {
  try {
    const { checkoutId } = req.params;
    const checkoutData = await getCheckout(checkoutId);
    res.json({
      success: true,
      data: checkoutData,
    });
  } catch (error) {
    next(error);
  }
});

// Toggle shipping insurance fee (add or remove based on enabled flag)
router.put("/:checkoutId/fee", async (req, res, next) => {
  try {
    const { checkoutId } = req.params;
    const { enabled, subtotal } = req.body;

    // Validate enabled flag
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error:
          "The 'enabled' field is required and must be a boolean (true/false)",
      });
    }

    // If enabling, subtotal is required
    if (enabled) {
      const subtotalValue = Number(subtotal);
      if (!Number.isFinite(subtotalValue) || subtotalValue <= 0) {
        return res.status(400).json({
          success: false,
          error:
            "A valid numeric subtotal greater than 0 is required when enabling insurance",
        });
      }
    }

    const result = await toggleShippingInsuranceFee(
      checkoutId,
      enabled,
      enabled ? Number(subtotal) : null
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// Test endpoint (combines get checkout and toggle fee)
router.post("/test", async (req, res, next) => {
  try {
    const checkoutId =
      req.body.checkoutId || "52537871-c507-4f11-a6bc-87da398d2c34";
    const enabled = req.body.enabled !== undefined ? req.body.enabled : true;

    console.log("🚀 Starting BigCommerce API test...");

    // First, try to get the checkout
    const checkoutData = await getCheckout(checkoutId);

    const subtotal =
      checkoutData.data?.cart?.base_amount ||
      checkoutData.data?.cart?.cart_amount ||
      100;
    console.log("Checkout retrieved:", checkoutData);

    // Then try to toggle the fee
    const feeResult = await toggleShippingInsuranceFee(
      checkoutId,
      enabled,
      enabled ? subtotal : null
    );
    console.log("Fee toggled:", feeResult);

    res.json({
      success: true,
      checkout: checkoutData,
      fee: feeResult,
    });
  } catch (error) {
    console.error("❌ API test failed:", error.message);
    next(error);
  }
});

export default router;
