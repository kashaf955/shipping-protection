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
            fee.id
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
      // DISABLE: Remove the fee using DELETE
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

      // DELETE fees by sending IDs in request body
      const deleteUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees`;

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
            body: JSON.stringify({
              ids: [existingFee.id],
            }),
          },
          15000
        );

        console.log(`📥 DELETE response status: ${deleteResponse.status}`);

        // DELETE returns 200 with checkout data, 204 No Content, or 404 if already removed
        if (
          deleteResponse.ok ||
          deleteResponse.status === 200 ||
          deleteResponse.status === 204 ||
          deleteResponse.status === 404
        ) {
          console.log(
            `✅ DELETE request successful (${deleteResponse.status})`
          );

          // If 200, parse the response (BigCommerce returns checkout data)
          if (deleteResponse.status === 200) {
            try {
              const responseData = await deleteResponse.json();
              console.log(`📥 DELETE response data:`, responseData);
            } catch (e) {
              // Not JSON, that's okay
            }
          }

          return {
            enabled: false,
            action: "deleted",
            amount: 0,
            message: "Fee successfully removed",
          };
        } else {
          const errorText = await deleteResponse.text().catch(() => "");
          throw new Error(
            `DELETE failed: ${deleteResponse.status} - ${errorText}`
          );
        }
      } catch (deleteError) {
        console.error(`❌ DELETE request failed: ${deleteError.message}`);
        throw new Error(`Fee removal failed: ${deleteError.message}`);
      }
    }
  } catch (error) {
    console.error(`❌ Error toggling shipping insurance:`, error.message);
    throw error;
  }
}
