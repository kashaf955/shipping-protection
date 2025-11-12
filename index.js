const STORE_HASH = "rq7pvrrofg"; // 🔹 replace
const ACCESS_TOKEN = "aa42focg6h31aspul7b9augvlm2t9wx"; // 🔹 replace

// Get checkout
// Add Insurance Fee
// Deduct Insurance Fee

// Helper function to create fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

// Get checkout details
async function getCheckout(checkoutId) {
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
async function addShippingInsuranceFee(checkoutId, subtotal) {
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

// Main function to test the API
async function testBigCommerceAPI() {
  const checkoutId = "52537871-c507-4f11-a6bc-87da398d2c34";
  // const subtotal = 100;

  try {
    console.log("🚀 Starting BigCommerce API test...");

    // First, try to get the checkout
    const checkoutData = await getCheckout(checkoutId);

    const subtotal = checkoutData.data.cart.base_amount;
    console.log("Checkout retrieved:", checkoutData);

    // Then try to add the fee
    const feeResult = await addShippingInsuranceFee(checkoutId, subtotal);
    console.log("Fee added:", feeResult);

    return { success: true, checkout: checkoutData, fee: feeResult };
  } catch (error) {
    console.error("❌ API test failed:", error.message);
    return { success: false, error: error.message };
  }
}

// Run the test
const result = await testBigCommerceAPI();
console.log("🏁 Final result:", result);
