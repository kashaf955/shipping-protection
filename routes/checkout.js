import express from "express";
import {
  getCheckout,
  addShippingInsuranceFee,
  removeShippingInsuranceFee,
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

// Add shipping insurance fee
router.post("/:checkoutId/fee", async (req, res, next) => {
  try {
    const { checkoutId } = req.params;
    const { subtotal } = req.body;
    const subtotalValue = Number(subtotal);

    if (!Number.isFinite(subtotalValue)) {
      return res.status(400).json({
        success: false,
        error: "A numeric subtotal is required",
      });
    }

    const feeResult = await addShippingInsuranceFee(checkoutId, subtotalValue);
    
    // If fee already exists, still return success
    if (feeResult.alreadyExists) {
      return res.json({
        success: true,
        data: { ...feeResult, message: "Fee already exists" },
      });
    }
    
    res.json({
      success: true,
      data: feeResult,
    });
  } catch (error) {
    next(error);
  }
});

// Remove shipping insurance fee
router.delete("/:checkoutId/fee", async (req, res, next) => {
  try {
    const { checkoutId } = req.params;
    const removalResult = await removeShippingInsuranceFee(checkoutId);
    
    // Success cases: fee was removed, or fee not found (already removed)
    if (removalResult.removed) {
      return res.json({
        success: true,
        data: removalResult,
      });
    }
    
    // Idempotent success: fee not found or no fees (already removed)
    if (removalResult.reason === "not_found" || removalResult.reason === "no_fees") {
      return res.json({
        success: true,
        data: { 
          removed: false, 
          reason: removalResult.reason,
          message: "Fee not found or already removed"
        },
      });
    }
    
    // Actual failure: removal failed
    if (removalResult.reason === "removal_failed") {
      return res.status(500).json({
        success: false,
        error: removalResult.error || "Failed to remove fee from BigCommerce",
        data: removalResult
      });
    }
    
    // Default: treat as success (idempotent)
    res.json({
      success: true,
      data: removalResult,
    });
  } catch (error) {
    // Unexpected errors return error status
    console.error("Unexpected error in fee removal:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to remove fee",
      data: {
        removed: false,
        reason: "error",
        error: error.message
      }
    });
  }
});

// Test endpoint (combines get checkout and add fee)
router.post("/test", async (req, res, next) => {
  try {
    const checkoutId =
      req.body.checkoutId || "52537871-c507-4f11-a6bc-87da398d2c34";
    // const subtotal = 100;

    console.log("🚀 Starting BigCommerce API test...");

    // First, try to get the checkout
    const checkoutData = await getCheckout(checkoutId);

    const subtotal = checkoutData.data.cart.base_amount;
    console.log("Checkout retrieved:", checkoutData);

    // Then try to add the fee
    const feeResult = await addShippingInsuranceFee(checkoutId, subtotal);
    console.log("Fee added:", feeResult);

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
