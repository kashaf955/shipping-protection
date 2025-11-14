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
    console.log(`🔍 Starting fee removal for checkout: ${checkoutId}`);
    const checkout = await getCheckout(checkoutId);
    
    // Try multiple possible locations for fees
    const fees =
      checkout?.data?.fees ??
      checkout?.data?.cart?.fees ??
      checkout?.fees ??
      [];

    console.log(`📋 Found ${Array.isArray(fees) ? fees.length : 0} fee(s) in checkout`);
    
    if (!Array.isArray(fees) || fees.length === 0) {
      console.log("ℹ️ No fees found in checkout");
      return { removed: false, reason: "no_fees" };
    }

    // Log all fees for debugging
    console.log("📋 All fees:", fees.map(f => ({
      id: f.id,
      name: f.name,
      display_name: f.display_name,
      type: f.type
    })));

    // Find all shipping insurance fees (in case there are multiple)
    const feesToRemove = fees.filter(
      (fee) =>
        (fee.name?.toLowerCase() === "shipping insurance" ||
          fee.display_name?.toLowerCase() === "shipping insurance" ||
          fee.title?.toLowerCase() === "shipping insurance") &&
        fee.id // Only remove fees that have an ID
    );

    console.log(`🎯 Found ${feesToRemove.length} shipping insurance fee(s) to remove:`, 
      feesToRemove.map(f => ({ id: f.id, name: f.name })));

    if (feesToRemove.length === 0) {
      console.log("ℹ️ No shipping insurance fee found to remove");
      return { removed: false, reason: "not_found" };
    }

    // Remove all matching fees (usually just one, but handle multiple)
    const removalPromises = feesToRemove.map(async (fee) => {
      try {
        const deleteUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${fee.id}`;
        console.log(`🗑️ Attempting to DELETE fee ${fee.id} from: ${deleteUrl}`);
        console.log(`📋 Fee details:`, {
          id: fee.id,
          name: fee.name,
          display_name: fee.display_name,
          type: fee.type,
          cost: fee.cost
        });
        
        const response = await fetchWithTimeout(
          deleteUrl,
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

        console.log(`📡 DELETE response status: ${response.status} for fee ${fee.id}`);
        
        // Get response body if available
        let responseBody = null;
        try {
          const text = await response.text();
          if (text) {
            try {
              responseBody = JSON.parse(text);
            } catch {
              responseBody = text;
            }
          }
        } catch {
          // No body, that's fine for DELETE
        }
        
        if (responseBody) {
          console.log(`📡 DELETE response body:`, responseBody);
        }

        // 204 No Content means successful deletion
        // 404 means fee was already removed (treat as success)
        if (response.status === 204 || response.status === 404) {
          console.log(
            `✅ Fee ${fee.id} DELETE returned status ${response.status}`
          );
          
          // CRITICAL: Verify the fee is actually gone by fetching checkout again
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for BigCommerce to process
          
          const verifyCheckout = await getCheckout(checkoutId);
          const verifyFees =
            verifyCheckout?.data?.fees ??
            verifyCheckout?.data?.cart?.fees ??
            verifyCheckout?.fees ??
            [];
          
          const feeStillExists = Array.isArray(verifyFees) && verifyFees.some(f => 
            f.id === fee.id ||
            (f.name?.toLowerCase() === "shipping insurance" ||
             f.display_name?.toLowerCase() === "shipping insurance")
          );
          
          if (feeStillExists) {
            console.error(`❌ Fee ${fee.id} still exists after DELETE! Verification failed.`);
            return { 
              success: false, 
              feeId: fee.id, 
              error: "Fee still exists after DELETE request",
              status: response.status
            };
          }
          
          console.log(`✅ Fee ${fee.id} verified as removed from checkout`);
          return { success: true, feeId: fee.id, alreadyRemoved: response.status === 404 };
        }

        // Other status codes (200, etc.) - check if it's ok but verify anyway
        if (response.ok && response.status !== 204 && response.status !== 404) {
          console.warn(`⚠️ DELETE returned unexpected status ${response.status}, verifying...`);
          
          // Verify the fee is actually gone
          await new Promise(resolve => setTimeout(resolve, 1000));
          const verifyCheckout = await getCheckout(checkoutId);
          const verifyFees =
            verifyCheckout?.data?.fees ??
            verifyCheckout?.data?.cart?.fees ??
            verifyCheckout?.fees ??
            [];
          
          const feeStillExists = Array.isArray(verifyFees) && verifyFees.some(f => 
            f.id === fee.id ||
            (f.name?.toLowerCase() === "shipping insurance" ||
             f.display_name?.toLowerCase() === "shipping insurance")
          );
          
          if (feeStillExists) {
            console.error(`❌ Fee ${fee.id} still exists after DELETE with status ${response.status}!`);
            return { 
              success: false, 
              feeId: fee.id, 
              error: `Fee still exists after DELETE (status: ${response.status})`,
              status: response.status
            };
          }
          
          return { success: true, feeId: fee.id };
        }

        // Other errors (non-ok status)
        if (!response.ok) {
          const errorText = responseBody || `Status ${response.status}`;
          console.error(
            `❌ Failed to remove fee ${fee.id}: ${response.status} - ${JSON.stringify(errorText)}`
          );
          return { 
            success: false, 
            feeId: fee.id, 
            error: typeof errorText === 'string' ? errorText : JSON.stringify(errorText),
            status: response.status
          };
        }

        // Fallthrough - shouldn't reach here
        console.warn(`⚠️ Unexpected response for fee ${fee.id}: status ${response.status}`);
        return { success: false, feeId: fee.id, error: `Unexpected response status: ${response.status}` };
      } catch (error) {
        console.error(`❌ Error removing fee ${fee.id}:`, error.message);
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
      // If all removals failed, return removal_failed
      const firstError = results.find((r) => !r.success);
      const errorMsg = firstError?.error || "Unknown error";
      console.error(`❌ Could not remove fee: ${errorMsg}`);
      return { 
        removed: false, 
        reason: "removal_failed",
        error: errorMsg,
        details: results
      };
    }
  } catch (error) {
    console.error("❌ Error removing fee:", error.message);
    throw error;
  }
}
