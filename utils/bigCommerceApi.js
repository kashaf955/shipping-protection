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

    console.log(
      `📋 Found ${Array.isArray(fees) ? fees.length : 0} fee(s) in checkout`
    );

    if (!Array.isArray(fees) || fees.length === 0) {
      console.log("ℹ️ No fees found in checkout");
      return { removed: false, reason: "no_fees" };
    }

    // Log all fees for debugging
    console.log(
      "📋 All fees:",
      fees.map((f) => ({
        id: f.id,
        name: f.name,
        display_name: f.display_name,
        type: f.type,
      }))
    );

    // Find all shipping insurance fees (in case there are multiple)
    const feesToRemove = fees.filter(
      (fee) =>
        (fee.name?.toLowerCase() === "shipping insurance" ||
          fee.display_name?.toLowerCase() === "shipping insurance" ||
          fee.title?.toLowerCase() === "shipping insurance") &&
        fee.id // Only remove fees that have an ID
    );

    console.log(
      `🎯 Found ${feesToRemove.length} shipping insurance fee(s) to remove:`,
      feesToRemove.map((f) => ({ id: f.id, name: f.name }))
    );

    if (feesToRemove.length === 0) {
      console.log("ℹ️ No shipping insurance fee found to remove");
      return { removed: false, reason: "not_found" };
    }

    // BigCommerce DELETE endpoint returns 404 - likely doesn't support deleting fees
    // Workaround: Set the shipping insurance fee cost to $0.00 instead of removing it
    // This effectively removes it from the total while keeping the fee object
    console.log("🔄 Removing fee by setting cost to $0.00...");

    // Prepare fees array with shipping insurance fee set to $0.00
    const feesToUpdate = Array.isArray(fees)
      ? fees.map((fee) => {
          const isShippingInsurance =
            fee.name?.toLowerCase() === "shipping insurance" ||
            fee.display_name?.toLowerCase() === "shipping insurance" ||
            fee.title?.toLowerCase() === "shipping insurance";
          
          if (isShippingInsurance) {
            // Set shipping insurance fee to $0.00
            console.log(`💰 Setting shipping insurance fee to $0.00 instead of removing`);
            return {
              type: fee.type || "custom_fee",
              name: fee.name,
              display_name: fee.display_name || fee.name,
              cost: 0, // Set to $0.00
              source: fee.source || "AA",
              ...(fee.tax_class_id !== null && fee.tax_class_id !== undefined && { tax_class_id: fee.tax_class_id }),
            };
          } else {
            // Keep other fees as-is
            return {
              type: fee.type || "custom_fee",
              name: fee.name,
              display_name: fee.display_name || fee.name,
              cost: fee.cost || fee.cost_inc_tax || fee.cost_ex_tax || 0,
              source: fee.source || "AA",
              ...(fee.tax_class_id !== null && fee.tax_class_id !== undefined && { tax_class_id: fee.tax_class_id }),
            };
          }
        })
      : [];

    const shippingInsuranceFeesCount = Array.isArray(fees)
      ? fees.filter((f) => {
          const name = (f.name || f.display_name || f.title || "").toLowerCase();
          return name === "shipping insurance";
        }).length
      : 0;

    console.log(
      `📊 Updated fees array: ${feesToUpdate.length} fee(s) (setting ${shippingInsuranceFeesCount} shipping insurance fee(s) to $0.00)`
    );

    console.log(`📤 Fees to update:`, JSON.stringify(feesToUpdate, null, 2));

    // Method 1: Try POST to fees endpoint with filtered array (might replace all fees)
    // BigCommerce might replace all fees when POSTing to /fees endpoint
    const feesPostUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees`;
    
    console.log(`📤 POST request to replace fees: ${feesPostUrl}`);
    console.log(`📤 POST body (all fees without insurance):`, JSON.stringify({ fees: feesToUpdate }, null, 2));

    try {
      const feesPostResponse = await fetchWithTimeout(
        feesPostUrl,
        {
          method: "POST",
          headers: {
            "X-Auth-Token": ACCESS_TOKEN,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            fees: feesToUpdate,
          }),
        },
        15000
      );

      console.log(`📡 Fees POST response status: ${feesPostResponse.status}`);

      let feesPostBody = null;
      try {
        const text = await feesPostResponse.text();
        if (text) {
          try {
            feesPostBody = JSON.parse(text);
          } catch {
            feesPostBody = text;
          }
        }
      } catch (error) {
        console.error(`Error reading fees POST response:`, error.message);
      }

      if (feesPostBody) {
        console.log(`📡 Fees POST response body:`, feesPostBody);
      }

      // Wait for BigCommerce to process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify the fee is actually removed (either gone or cost is $0)
      const verifyCheckout = await getCheckout(checkoutId);
      const verifyFees =
        verifyCheckout?.data?.fees ??
        verifyCheckout?.data?.cart?.fees ??
        verifyCheckout?.fees ??
        [];

      const shippingInsuranceFee = Array.isArray(verifyFees)
        ? verifyFees.find(
            (f) =>
              f.name?.toLowerCase() === "shipping insurance" ||
              f.display_name?.toLowerCase() === "shipping insurance"
          )
        : null;

      // Fee is "removed" if it doesn't exist OR if its cost is $0.00
      const feeRemoved =
        !shippingInsuranceFee ||
        (shippingInsuranceFee.cost === 0 &&
          (shippingInsuranceFee.cost_inc_tax === 0 ||
            shippingInsuranceFee.cost_inc_tax === null ||
            shippingInsuranceFee.cost_inc_tax === undefined));

      if (feeRemoved) {
        console.log(`✅ Fees removed successfully via fees POST method (cost set to $0.00)`);
        return {
          removed: true,
          count: feesToRemove.length,
          method: "POST_fees_zero_cost",
        };
      } else {
        console.error(`❌ Fee still has cost after fees POST - verification failed`);
        console.log(`Shipping insurance fee:`, shippingInsuranceFee);
      }
    } catch (postError) {
      console.error(`❌ Fees POST method failed:`, postError.message);
    }

    // Method 2: Try PUT on checkout endpoint - update entire checkout with new fees array
    const checkoutUpdateUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}`;
    
    console.log(`📤 PUT request to update checkout: ${checkoutUpdateUrl}`);

    try {
      const checkoutUpdateResponse = await fetchWithTimeout(
        checkoutUpdateUrl,
        {
          method: "PUT",
          headers: {
            "X-Auth-Token": ACCESS_TOKEN,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            fees: feesToUpdate,
          }),
        },
        15000
      );

      console.log(`📡 Checkout PUT response status: ${checkoutUpdateResponse.status}`);

      let checkoutUpdateBody = null;
      try {
        const text = await checkoutUpdateResponse.text();
        if (text) {
          try {
            checkoutUpdateBody = JSON.parse(text);
          } catch {
            checkoutUpdateBody = text;
          }
        }
      } catch (error) {
        console.error(`Error reading checkout PUT response:`, error.message);
      }

      if (checkoutUpdateBody) {
        console.log(`📡 Checkout PUT response body:`, checkoutUpdateBody);
      }

      if (!checkoutUpdateResponse.ok) {
        console.error(`❌ Checkout PUT failed with status ${checkoutUpdateResponse.status}`);
        console.error(`Error response:`, checkoutUpdateBody);
        // Don't verify if PUT failed - fall through to DELETE
      } else {
        // Wait for BigCommerce to process the update
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify the fee is actually gone
        const verifyCheckout = await getCheckout(checkoutId);
        const verifyFees =
          verifyCheckout?.data?.fees ??
          verifyCheckout?.data?.cart?.fees ??
          verifyCheckout?.fees ??
          [];

        const shippingInsuranceFee = Array.isArray(verifyFees)
          ? verifyFees.find(
              (f) =>
                f.name?.toLowerCase() === "shipping insurance" ||
                f.display_name?.toLowerCase() === "shipping insurance"
            )
          : null;

        // Fee is "removed" if it doesn't exist OR if its cost is $0.00
        const feeRemoved =
          !shippingInsuranceFee ||
          (shippingInsuranceFee.cost === 0 &&
            (shippingInsuranceFee.cost_inc_tax === 0 ||
              shippingInsuranceFee.cost_inc_tax === null ||
              shippingInsuranceFee.cost_inc_tax === undefined));

        if (feeRemoved) {
          console.log(`✅ Fees removed successfully via checkout PUT update (cost set to $0.00)`);
          return {
            removed: true,
            count: feesToRemove.length,
            method: "PUT_checkout_zero_cost",
          };
        } else {
          console.error(`❌ Fee still has cost after checkout PUT update - verification failed`);
          console.log(`Shipping insurance fee:`, shippingInsuranceFee);
        }
      }
    } catch (updateError) {
      console.error(`❌ Checkout PUT update method failed:`, updateError.message);
      // Fall through to DELETE method below
    }

    // If PUT method didn't work, try DELETE method
    console.log("🔄 Falling back to DELETE method...");
    const removalPromises = feesToRemove.map(async (fee) => {
      try {
        const deleteUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${fee.id}`;
        console.log(`🗑️ Attempting to DELETE fee ${fee.id} from: ${deleteUrl}`);
        console.log(`📋 Fee details:`, {
          id: fee.id,
          name: fee.name,
          display_name: fee.display_name,
          type: fee.type,
          cost: fee.cost,
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

        console.log(
          `📡 DELETE response status: ${response.status} for fee ${fee.id}`
        );

        // Get response body to see the actual error
        let responseBody = null;
        let responseText = "";
        try {
          responseText = await response.text();
          if (responseText) {
            try {
              responseBody = JSON.parse(responseText);
            } catch {
              responseBody = responseText;
            }
          }
        } catch (error) {
          console.error(`Error reading response body:`, error.message);
        }

        console.log(
          `📡 DELETE response body:`,
          responseBody || responseText || "(empty)"
        );

        // 204 No Content means successful deletion - verify it's actually gone
        if (response.status === 204) {
          console.log(`✅ Fee ${fee.id} DELETE returned 204 (No Content)`);

          // CRITICAL: Verify the fee is actually gone by fetching checkout again
          await new Promise((resolve) => setTimeout(resolve, 1500)); // Wait for BigCommerce to process

          const verifyCheckout = await getCheckout(checkoutId);
          const verifyFees =
            verifyCheckout?.data?.fees ??
            verifyCheckout?.data?.cart?.fees ??
            verifyCheckout?.fees ??
            [];

          const feeStillExists =
            Array.isArray(verifyFees) &&
            verifyFees.some(
              (f) =>
                f.id === fee.id ||
                f.name?.toLowerCase() === "shipping insurance" ||
                f.display_name?.toLowerCase() === "shipping insurance"
            );

          if (feeStillExists) {
            console.error(
              `❌ Fee ${fee.id} still exists after DELETE 204! BigCommerce may not have processed the deletion.`
            );
            return {
              success: false,
              feeId: fee.id,
              error: "Fee still exists after DELETE request (status 204)",
              status: response.status,
              responseBody: responseBody,
            };
          }

          console.log(`✅ Fee ${fee.id} verified as removed from checkout`);
          return { success: true, feeId: fee.id };
        }

        // 404 means endpoint or fee not found - this is an ERROR, not success
        if (response.status === 404) {
          console.error(
            `❌ Fee ${fee.id} DELETE returned 404 - fee or endpoint not found`
          );
          console.error(`Response body:`, responseBody || responseText);

          // 404 could mean:
          // 1. Fee ID is wrong
          // 2. Endpoint format is wrong
          // 3. Fee was already removed (but we checked it exists before)

          // Verify if fee still exists
          const verifyCheckout = await getCheckout(checkoutId);
          const verifyFees =
            verifyCheckout?.data?.fees ??
            verifyCheckout?.data?.cart?.fees ??
            verifyCheckout?.fees ??
            [];

          const feeStillExists =
            Array.isArray(verifyFees) &&
            verifyFees.some(
              (f) =>
                f.id === fee.id ||
                f.name?.toLowerCase() === "shipping insurance" ||
                f.display_name?.toLowerCase() === "shipping insurance"
            );

          if (feeStillExists) {
            const errorMsg =
              responseBody?.title ||
              responseBody?.message ||
              responseBody?.error ||
              (typeof responseBody === "string"
                ? responseBody
                : JSON.stringify(responseBody)) ||
              "Fee still exists but DELETE returned 404 - possible API issue";
            console.error(`❌ Fee still exists after 404! Error: ${errorMsg}`);
            return {
              success: false,
              feeId: fee.id,
              error: errorMsg,
              status: response.status,
              responseBody: responseBody,
              feeStillExists: true,
            };
          } else {
            // Fee is actually gone (maybe deleted by another process)
            console.log(`ℹ️ Fee ${fee.id} not found (already removed)`);
            return { success: true, feeId: fee.id, alreadyRemoved: true };
          }
        }

        // Other status codes (200, etc.) - check if it's ok but verify anyway
        if (response.ok && response.status !== 204 && response.status !== 404) {
          console.warn(
            `⚠️ DELETE returned unexpected status ${response.status}, verifying...`
          );

          // Verify the fee is actually gone
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const verifyCheckout = await getCheckout(checkoutId);
          const verifyFees =
            verifyCheckout?.data?.fees ??
            verifyCheckout?.data?.cart?.fees ??
            verifyCheckout?.fees ??
            [];

          const feeStillExists =
            Array.isArray(verifyFees) &&
            verifyFees.some(
              (f) =>
                f.id === fee.id ||
                f.name?.toLowerCase() === "shipping insurance" ||
                f.display_name?.toLowerCase() === "shipping insurance"
            );

          if (feeStillExists) {
            console.error(
              `❌ Fee ${fee.id} still exists after DELETE with status ${response.status}!`
            );
            return {
              success: false,
              feeId: fee.id,
              error: `Fee still exists after DELETE (status: ${response.status})`,
              status: response.status,
            };
          }

          return { success: true, feeId: fee.id };
        }

        // Other errors (non-ok status)
        if (!response.ok) {
          const errorText = responseBody || `Status ${response.status}`;
          console.error(
            `❌ Failed to remove fee ${fee.id}: ${
              response.status
            } - ${JSON.stringify(errorText)}`
          );
          return {
            success: false,
            feeId: fee.id,
            error:
              typeof errorText === "string"
                ? errorText
                : JSON.stringify(errorText),
            status: response.status,
          };
        }

        // Fallthrough - shouldn't reach here
        console.warn(
          `⚠️ Unexpected response for fee ${fee.id}: status ${response.status}`
        );
        return {
          success: false,
          feeId: fee.id,
          error: `Unexpected response status: ${response.status}`,
        };
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
        alreadyRemoved: alreadyRemoved.length > 0,
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
        details: results,
      };
    }
  } catch (error) {
    console.error("❌ Error removing fee:", error.message);
    throw error;
  }
}
