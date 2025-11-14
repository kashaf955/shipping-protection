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

      console.log(
        `🗑️ Removing shipping insurance fee (fee ID: ${existingFee.id})`
      );

      // Strategy 1: Try DELETE first (proper REST method)
      const deleteUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${existingFee.id}`;

      console.log(
        `📤 DELETE request to remove fee ${existingFee.id}: ${deleteUrl}`
      );

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
        if (
          deleteResponse.ok ||
          deleteResponse.status === 204 ||
          deleteResponse.status === 404
        ) {
          console.log(`✅ DELETE request returned ${deleteResponse.status}`);

          // Verify deletion by fetching checkout again (wait longer for BigCommerce to process)
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const verifyCheckout = await getCheckout(checkoutId);
          const verifyFees =
            verifyCheckout?.data?.fees ??
            verifyCheckout?.data?.cart?.fees ??
            verifyCheckout?.fees ??
            [];

          // Check if fee still exists by ID and cost (check all cost fields)
          const stillExists = verifyFees.some((fee) => {
            const isShippingInsurance =
              fee.id === existingFee.id ||
              fee.name?.toLowerCase() === "shipping insurance" ||
              fee.display_name?.toLowerCase() === "shipping insurance";

            if (!isShippingInsurance) return false;

            // Check all possible cost fields
            const cost = fee?.cost || 0;
            const costIncTax = fee?.cost_inc_tax || 0;
            const costExTax = fee?.cost_ex_tax || 0;
            const hasNonZeroCost = cost > 0 || costIncTax > 0 || costExTax > 0;

            return hasNonZeroCost;
          });

          if (!stillExists) {
            console.log(
              "✅ Shipping insurance fee verified as removed via DELETE"
            );
            return {
              enabled: false,
              action: "deleted",
              amount: 0,
              message: "Fee successfully removed",
            };
          } else {
            console.log(
              "⚠️ DELETE returned success but fee still exists after verification, trying POST method..."
            );
            console.log(
              "⚠️ Fee details:",
              verifyFees.find(
                (f) =>
                  f.id === existingFee.id ||
                  f.name?.toLowerCase() === "shipping insurance" ||
                  f.display_name?.toLowerCase() === "shipping insurance"
              )
            );
            // Fall through to POST method
          }
        } else {
          console.log(
            `⚠️ DELETE returned ${deleteResponse.status}, trying POST method...`
          );
          // Fall through to POST method
        }
      } catch (deleteError) {
        console.log(
          `⚠️ DELETE failed: ${deleteError.message}, trying POST method...`
        );
        // Fall through to POST method
      }

      // Strategy 2: Use POST to replace entire fees array without shipping insurance fee
      // Get fresh checkout data to ensure we have all current fees
      const freshCheckout = await getCheckout(checkoutId);
      const allFees =
        freshCheckout?.data?.fees ??
        freshCheckout?.data?.cart?.fees ??
        freshCheckout?.fees ??
        (Array.isArray(fees) ? fees : []);

      console.log(
        `📋 Current fees before filtering: ${allFees.length}`,
        allFees.map((f) => ({
          id: f.id,
          name: f.name,
          cost: f.cost,
          cost_inc_tax: f.cost_inc_tax,
        }))
      );

      // Filter out shipping insurance fee (by ID and by name as fallback)
      const feesWithoutInsurance = allFees.filter((fee) => {
        const isShippingInsurance =
          fee.id === existingFee.id ||
          fee.name?.toLowerCase() === "shipping insurance" ||
          fee.display_name?.toLowerCase() === "shipping insurance";

        if (isShippingInsurance) {
          console.log(`🗑️ Filtering out fee:`, {
            id: fee.id,
            name: fee.name,
            cost: fee.cost,
            cost_inc_tax: fee.cost_inc_tax,
          });
        }

        return !isShippingInsurance;
      });

      console.log(
        `📋 Fees after filtering: ${feesWithoutInsurance.length}`,
        feesWithoutInsurance.map((f) => ({
          id: f.id,
          name: f.name,
          cost: f.cost,
        }))
      );

      // If no fees left, BigCommerce doesn't accept empty array - skip to Strategy 3
      if (feesWithoutInsurance.length === 0) {
        console.log(
          "⚠️ No fees left after filtering - BigCommerce doesn't accept empty fees array. Skipping POST and trying cost=$0.01 workaround..."
        );
        // Fall through to Strategy 3
      } else {
        // Try POST to replace fees array (only if there are other fees)
        console.log(
          `📤 POST request to replace fees array (excluding shipping insurance)`
        );

        const postUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees`;

        // Build fees payload - DO NOT include 'id' field (BigCommerce creates new IDs)
        // Only include fields that are allowed when creating fees
        const feesPayload = feesWithoutInsurance.map((fee) => {
          // Extract base cost (prefer cost_inc_tax if cost is missing)
          const baseCost = fee.cost ?? fee.cost_inc_tax ?? fee.cost_ex_tax ?? 0;

          const feeData = {
            type: fee.type || "custom_fee",
            name: fee.name || "",
            display_name: fee.display_name || fee.name || "",
            cost: baseCost,
            source: fee.source || "AA",
          };

          // Include tax_class_id if present (only if not null/undefined)
          if (
            fee.tax_class_id !== null &&
            fee.tax_class_id !== undefined &&
            fee.tax_class_id !== ""
          ) {
            feeData.tax_class_id = fee.tax_class_id;
          }

          return feeData;
        });

        console.log(
          `📤 POST payload:`,
          JSON.stringify({ fees: feesPayload }, null, 2)
        );

        try {
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
                fees: feesPayload,
              }),
            },
            15000
          );

          console.log(`📥 POST response status: ${postResponse.status}`);

          if (!postResponse.ok) {
            let errorData;
            try {
              errorData = await postResponse.json();
            } catch {
              errorData = { message: await postResponse.text() };
            }
            console.error(`❌ POST failed:`, errorData);
            console.log(
              "⚠️ POST failed - skipping to cost=$0.01 workaround..."
            );
            // Fall through to Strategy 3
          } else {
            const postData = await postResponse.json();
            console.log(`📥 POST response data:`, postData);

            // Verify removal - wait longer for BigCommerce to process
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const verifyCheckout = await getCheckout(checkoutId);
            const verifyFees =
              verifyCheckout?.data?.fees ??
              verifyCheckout?.data?.cart?.fees ??
              verifyCheckout?.fees ??
              [];

            console.log(
              `🔍 Verification - checking ${verifyFees.length} fees:`,
              verifyFees.map((f) => ({
                id: f.id,
                name: f.name,
                cost: f.cost,
                cost_inc_tax: f.cost_inc_tax,
              }))
            );

            // Check if fee still exists (check all cost fields)
            const stillExists = verifyFees.some((fee) => {
              const isShippingInsurance =
                fee.id === existingFee.id ||
                fee.name?.toLowerCase() === "shipping insurance" ||
                fee.display_name?.toLowerCase() === "shipping insurance";

              if (!isShippingInsurance) return false;

              // Check all possible cost fields
              const cost = fee?.cost || 0;
              const costIncTax = fee?.cost_inc_tax || 0;
              const costExTax = fee?.cost_ex_tax || 0;
              const hasNonZeroCost =
                cost > 0 || costIncTax > 0 || costExTax > 0;

              if (hasNonZeroCost) {
                console.log(`⚠️ Fee still exists with non-zero cost:`, {
                  id: fee.id,
                  cost,
                  cost_inc_tax: costIncTax,
                  cost_ex_tax: costExTax,
                });
              }

              return hasNonZeroCost;
            });

            if (!stillExists) {
              console.log(
                "✅ Shipping insurance fee removed successfully via POST"
              );
              return {
                enabled: false,
                action: "removed",
                amount: 0,
                fee: postData,
              };
            } else {
              console.log(
                "⚠️ POST succeeded but fee still exists after verification, trying cost=$0.01 workaround..."
              );
              // Fall through to Strategy 3
            }
          }
        } catch (postError) {
          console.error(`❌ POST request failed: ${postError.message}`);
          console.log("⚠️ POST error - skipping to cost=$0.01 workaround...");
          // Fall through to Strategy 3
        }
      }

      // Strategy 3: If POST doesn't work or wasn't attempted, set cost to $0.01 (minimum amount)
      // This effectively "removes" it from the total while keeping the fee object
      console.log(
        "⚠️ POST method didn't work or wasn't applicable - trying cost=$0.01 workaround..."
      );

      const updateUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${existingFee.id}`;

      console.log(`📤 PUT request to set fee cost to $0.01: ${updateUrl}`);

      const updateResponse = await fetchWithTimeout(
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
            cost: 0.01, // Set to minimum amount ($0.01) as workaround
            source: existingFee.source || "AA",
            ...(existingFee.tax_class_id !== null &&
              existingFee.tax_class_id !== undefined && {
                tax_class_id: existingFee.tax_class_id,
              }),
          }),
        },
        15000
      );

      if (updateResponse.ok) {
        console.log(
          "✅ Fee cost set to $0.01 as workaround (effectively removed)"
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return {
          enabled: false,
          action: "minimized",
          amount: 0.01,
          message: "Fee minimized to $0.01 (removal not supported)",
        };
      } else {
        const errorText = await updateResponse.text();
        console.error(
          `❌ PUT to minimize fee failed: ${updateResponse.status} - ${errorText}`
        );
        throw new Error(
          "Fee removal failed. BigCommerce API may not support fee removal or updating."
        );
      }
    }
  } catch (error) {
    console.error(`❌ Error toggling shipping insurance:`, error.message);
    throw error;
  }
}
