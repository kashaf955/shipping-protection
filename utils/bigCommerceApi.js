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

// Toggle shipping insurance fee (add if enabled=true, remove if enabled=false)
export async function toggleShippingInsuranceFee(
  checkoutId,
  enabled,
  subtotal = null
) {
  try {
    console.log(
      `🔄 Toggling shipping insurance: ${enabled ? "ENABLE" : "DISABLE"}`
    );

    // Get current checkout to check existing fees
    const checkout = await getCheckout(checkoutId);
    const fees =
      checkout?.data?.fees ??
      checkout?.data?.cart?.fees ??
      checkout?.fees ??
      [];

    // Find existing shipping insurance fee
    const existingFee = Array.isArray(fees)
      ? fees.find(
          (fee) =>
            (fee.name?.toLowerCase() === "shipping insurance" ||
              fee.display_name?.toLowerCase() === "shipping insurance") &&
            fee.id // Must have an ID to update
        )
      : null;

    if (enabled) {
      // ENABLE: Add or update fee to 4% of subtotal
      if (!subtotal || !Number.isFinite(subtotal) || subtotal <= 0) {
        throw new Error("Valid subtotal required to enable shipping insurance");
      }

      const amount = parseFloat((subtotal * 0.04).toFixed(2));
      console.log(`💰 Setting shipping insurance fee to $${amount}`);

      if (existingFee) {
        // Update existing fee
        const updateUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${existingFee.id}`;

        console.log(
          `📤 PUT request to update fee ${existingFee.id}: ${updateUrl}`
        );

        const response = await fetchWithTimeout(
          updateUrl,
          {
            method: "PUT",
            headers: {
              "X-Auth-Token": ACCESS_TOKEN,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              type: existingFee.type || "custom_fee",
              name: existingFee.name || "Shipping Insurance",
              display_name: existingFee.display_name || "Shipping Insurance",
              cost: amount,
              source: existingFee.source || "AA",
              ...(existingFee.tax_class_id !== null &&
                existingFee.tax_class_id !== undefined && {
                  tax_class_id: existingFee.tax_class_id,
                }),
            }),
          },
          15000
        );

        if (!response.ok) {
          let errorData;
          try {
            errorData = await response.json();
          } catch {
            errorData = { message: await response.text() };
          }
          throw new Error(
            `Failed to update fee: ${response.status} - ${JSON.stringify(
              errorData
            )}`
          );
        }

        const data = await response.json();
        console.log("✅ Shipping insurance fee updated successfully");
        return {
          enabled: true,
          action: "updated",
          amount: amount,
          fee: data,
        };
      } else {
        // Create new fee
        const createUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees`;

        console.log(`📤 POST request to create fee: ${createUrl}`);

        const response = await fetchWithTimeout(
          createUrl,
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
                  cost: amount,
                  source: "AA",
                },
              ],
            }),
          },
          15000
        );

        if (!response.ok) {
          let errorData;
          try {
            errorData = await response.json();
          } catch {
            errorData = { message: await response.text() };
          }
          throw new Error(
            `Failed to create fee: ${response.status} - ${JSON.stringify(
              errorData
            )}`
          );
        }

        const data = await response.json();
        console.log("✅ Shipping insurance fee created successfully");
        return {
          enabled: true,
          action: "created",
          amount: amount,
          fee: data,
        };
      }
    } else {
      // DISABLE: Remove the fee using DELETE or POST to replace fees array
      if (!existingFee) {
        console.log("ℹ️ Shipping insurance fee not found - already disabled");
        return {
          enabled: false,
          action: "already_disabled",
          message: "Fee not found or already removed",
        };
      }

      console.log(`🗑️ Removing shipping insurance fee (fee ID: ${existingFee.id})`);

      // Strategy 1: Try DELETE first (proper REST method)
      const deleteUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${existingFee.id}`;
      
      console.log(`📤 DELETE request to remove fee ${existingFee.id}: ${deleteUrl}`);

      try {
        const deleteResponse = await fetchWithTimeout(
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

        // DELETE returns 204 No Content on success, 404 if already removed
        if (deleteResponse.ok || deleteResponse.status === 204 || deleteResponse.status === 404) {
          console.log("✅ Shipping insurance fee deleted successfully via DELETE");
          
          // Verify deletion by fetching checkout again
          await new Promise(resolve => setTimeout(resolve, 500));
          const verifyCheckout = await getCheckout(checkoutId);
          const verifyFees = verifyCheckout?.data?.fees ?? verifyCheckout?.data?.cart?.fees ?? verifyCheckout?.fees ?? [];
          const stillExists = verifyFees.some(
            fee => fee.id === existingFee.id &&
            (fee.name?.toLowerCase() === "shipping insurance" ||
             fee.display_name?.toLowerCase() === "shipping insurance") &&
            fee.cost > 0
          );

          if (!stillExists) {
            return {
              enabled: false,
              action: "deleted",
              amount: 0,
              message: "Fee successfully removed",
            };
          } else {
            console.log("⚠️ DELETE succeeded but fee still exists, trying POST method...");
            // Fall through to POST method
          }
        } else {
          console.log(`⚠️ DELETE returned ${deleteResponse.status}, trying POST method...`);
          // Fall through to POST method
        }
      } catch (deleteError) {
        console.log(`⚠️ DELETE failed: ${deleteError.message}, trying POST method...`);
        // Fall through to POST method
      }

      // Strategy 2: Use POST to replace entire fees array without shipping insurance fee
      console.log(`📤 POST request to replace fees array (excluding shipping insurance)`);
      
      const allFees = Array.isArray(fees) ? fees : [];
      const feesWithoutInsurance = allFees.filter(
        (fee) =>
          !(
            fee.id === existingFee.id ||
            (fee.name?.toLowerCase() === "shipping insurance" ||
              fee.display_name?.toLowerCase() === "shipping insurance")
          )
      );

      const postUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees`;
      
      const postResponse = await fetchWithTimeout(
        postUrl,
        {
          method: "POST",
          headers: {
            "X-Auth-Token": ACCESS_TOKEN,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            fees: feesWithoutInsurance.map((fee) => ({
              type: fee.type,
              name: fee.name,
              display_name: fee.display_name,
              cost: fee.cost,
              source: fee.source,
              ...(fee.tax_class_id !== null && fee.tax_class_id !== undefined && {
                tax_class_id: fee.tax_class_id,
              }),
            })),
          }),
        },
        15000
      );

      if (!postResponse.ok) {
        let errorData;
        try {
          errorData = await postResponse.json();
        } catch {
          errorData = { message: await postResponse.text() };
        }
        throw new Error(
          `Failed to remove fee via POST: ${postResponse.status} - ${JSON.stringify(
            errorData
          )}`
        );
      }

      // Verify removal
      await new Promise(resolve => setTimeout(resolve, 500));
      const verifyCheckout = await getCheckout(checkoutId);
      const verifyFees = verifyCheckout?.data?.fees ?? verifyCheckout?.data?.cart?.fees ?? verifyCheckout?.fees ?? [];
      const stillExists = verifyFees.some(
        fee => fee.id === existingFee.id &&
        (fee.name?.toLowerCase() === "shipping insurance" ||
         fee.display_name?.toLowerCase() === "shipping insurance") &&
        fee.cost > 0
      );

      if (stillExists) {
        throw new Error("Fee still exists after POST request - removal failed");
      }

      const data = await postResponse.json();
      console.log("✅ Shipping insurance fee removed successfully via POST");
      return {
        enabled: false,
        action: "removed",
        amount: 0,
        fee: data,
      };
    }
  } catch (error) {
    console.error(`❌ Error toggling shipping insurance:`, error.message);
    throw error;
  }
}
