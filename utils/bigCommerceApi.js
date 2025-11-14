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
      // DISABLE: Set fee cost to $0.00
      if (!existingFee) {
        console.log("ℹ️ Shipping insurance fee not found - already disabled");
        return {
          enabled: false,
          action: "already_disabled",
          message: "Fee not found or already removed",
        };
      }

      console.log(`💰 Setting shipping insurance fee to $0.00 (disabling)`);

      const updateUrl = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${existingFee.id}`;

      console.log(
        `📤 PUT request to update fee ${existingFee.id} cost to $0.00: ${updateUrl}`
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
            cost: 0, // Set to $0.00
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
          `Failed to disable fee: ${response.status} - ${JSON.stringify(
            errorData
          )}`
        );
      }

      const data = await response.json();
      console.log(
        "✅ Shipping insurance fee disabled successfully (cost set to $0.00)"
      );
      return {
        enabled: false,
        action: "disabled",
        amount: 0,
        fee: data,
      };
    }
  } catch (error) {
    console.error(`❌ Error toggling shipping insurance:`, error.message);
    throw error;
  }
}
