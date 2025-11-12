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
        body: JSON.stringify(
          {
            fees: [
              {
                type: "custom_fee",
                name: "Shipping Insurance",
                display_name: "Shipping Insurance",
                cost: parseFloat(amount),
                source: "AA",
                // "tax_class_id": 1
              },
            ],
          }
          //   {
          //   fees: [{
          //     name: "Shipping Insurance",
          //     display_name: "Shipping Insurance",
          //     cost: parseFloat(amount),
          //     type: "fixed",
          //     source: "custom-app",
          //   }]
          // }
        ),
      },
      15000 // 15 second timeout
    );

    if (!response.ok) {
      const errorData = await response.json();
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
    const fees = checkout?.data?.fees ?? [];
    const feeToRemove = fees.find(
      (fee) =>
        fee.name?.toLowerCase() === "shipping insurance" ||
        fee.display_name?.toLowerCase() === "shipping insurance"
    );

    if (!feeToRemove) {
      console.log("ℹ️ No shipping insurance fee found to remove");
      return { removed: false, reason: "not_found" };
    }

    const response = await fetchWithTimeout(
      `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/checkouts/${checkoutId}/fees/${feeToRemove.id}`,
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

    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Failed to remove fee: ${response.status} - ${errorText}`
      );
    }

    console.log("✅ Shipping insurance fee removed successfully");
    return { removed: true };
  } catch (error) {
    console.error("❌ Error removing fee:", error.message);
    throw error;
  }
}
