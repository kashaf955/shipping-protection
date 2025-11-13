import { fetchWithTimeout } from "./fetchWithTimeout.js";
import { STORE_HASH, ACCESS_TOKEN } from "../config.js";

// Get checkout details
export async function getCheckout(checkoutId) {
  try {
    console.log(`Fetching checkout: ${checkoutId}`);

    const response = await fetchWithTimeout(
      `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}`,
      {
        method: "GET",
        headers: {
          "X-Auth-Token": ACCESS_TOKEN,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
      15000 // 15 second timeout
    );

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("✅ Checkout data retrieved successfully");
    return data;
  } catch (error) {
    console.error("❌ Error fetching checkout:", error.message);
    throw error;
  }
}

// Add shipping insurance fee
export async function addShippingInsuranceFee(checkoutId, subtotal) {
  try {
    // First check if fee already exists
    const checkout = await getCheckout(checkoutId);
    const fees =
      checkout?.data?.fees ??
      checkout?.data?.cart?.fees ??
      checkout?.fees ??
      [];

    const existingFee = Array.isArray(fees)
      ? fees.find(
          (fee) =>
            fee.name?.toLowerCase() === "shipping insurance" ||
            fee.display_name?.toLowerCase() === "shipping insurance"
        )
      : null;

    if (existingFee) {
      console.log("ℹ️ Shipping insurance fee already exists");
      return { alreadyExists: true, fee: existingFee };
    }

    const amount = (subtotal * 0.04).toFixed(2);
    console.log(`Adding shipping insurance fee: $${amount}`);

    const response = await fetchWithTimeout(
      `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees`,
      {
        method: "POST",
        headers: {
          "X-Auth-Token": ACCESS_TOKEN,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          fees: [
            {
              type: "custom_fee",
              name: "Shipping Insurance",
              display_name: "Shipping Insurance",
              cost: parseFloat(amount),
              source: "AA",
            },
          ],
        }),
      },
      15000 // 15 second timeout
    );

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: await response.text() };
      }
      throw new Error(
        `Failed to add fee: ${response.status} - ${JSON.stringify(errorData)}`
      );
    }

    const data = await response.json();
    console.log("✅ Shipping insurance fee added successfully");
    return data;
  } catch (error) {
    console.error("❌ Error adding fee:", error.message);
    throw error;
  }
}

export async function removeShippingInsuranceFee(checkoutId) {
  try {
    const checkout = await getCheckout(checkoutId);
    // Try multiple possible locations for fees
    const fees =
      checkout?.data?.fees ??
      checkout?.data?.cart?.fees ??
      checkout?.fees ??
      [];

    if (!Array.isArray(fees) || fees.length === 0) {
      console.log("ℹ️ No fees found in checkout");
      return { removed: false, reason: "no_fees" };
    }

    // Find all shipping insurance fees (in case there are multiple)
    const feesToRemove = fees.filter(
      (fee) =>
        (fee.name?.toLowerCase() === "shipping insurance" ||
          fee.display_name?.toLowerCase() === "shipping insurance" ||
          fee.title?.toLowerCase() === "shipping insurance") &&
        fee.id // Only remove fees that have an ID
    );

    if (feesToRemove.length === 0) {
      console.log("ℹ️ No shipping insurance fee found to remove");
      return { removed: false, reason: "not_found" };
    }

    // Remove all matching fees (usually just one, but handle multiple)
    const removalPromises = feesToRemove.map(async (fee) => {
      try {
        const response = await fetchWithTimeout(
          `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${fee.id}`,
          {
            method: "DELETE",
            headers: {
              "X-Auth-Token": ACCESS_TOKEN,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          },
          15000
        );

        // 204 No Content means successful deletion
        // 404 means fee was already removed (treat as success)
        if (response.status === 204 || response.status === 404) {
          console.log(
            `✅ Fee ${fee.id} removed (or already removed) - status: ${response.status}`
          );
          return { success: true, feeId: fee.id, alreadyRemoved: response.status === 404 };
        }

        // Other errors
        if (!response.ok) {
          let errorText;
          try {
            errorText = await response.json();
          } catch {
            errorText = await response.text();
          }
          console.error(
            `Failed to remove fee ${fee.id}: ${response.status} - ${JSON.stringify(errorText)}`
          );
          // Don't throw for non-critical errors, just log
          return { 
            success: false, 
            feeId: fee.id, 
            error: typeof errorText === 'string' ? errorText : JSON.stringify(errorText),
            status: response.status
          };
        }

        return { success: true, feeId: fee.id };
      } catch (error) {
        console.error(`Error removing fee ${fee.id}:`, error.message);
        return { success: false, feeId: fee.id, error: error.message };
      }
    });

    const results = await Promise.all(removalPromises);
    const successful = results.filter((r) => r.success);
    const alreadyRemoved = results.filter((r) => r.alreadyRemoved);

    // If at least one removal was successful OR fee was already removed, return success
    if (successful.length > 0 || alreadyRemoved.length > 0) {
      console.log(
        `✅ Shipping insurance fee(s) handled successfully: ${successful.length} removed, ${alreadyRemoved.length} already removed`
      );
      return { 
        removed: true, 
        count: successful.length,
        alreadyRemoved: alreadyRemoved.length > 0
      };
    } else {
      // If all removals failed, return not_found (don't throw error)
      const firstError = results.find((r) => !r.success);
      console.log(`ℹ️ Could not remove fee: ${firstError?.error || "Unknown error"}`);
      return { 
        removed: false, 
        reason: "removal_failed",
        error: firstError?.error || "Unknown error"
      };
    }
  } catch (error) {
    console.error("❌ Error removing fee:", error.message);
    throw error;
  }
}
