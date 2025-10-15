require("dotenv").config()
const express = require("express")
const cors = require("cors")
const stripe = require("stripe")(process.env.STRIPE_PRIVATE_KEY)
const admin = require("firebase-admin")

// Initialize Firebase Admin
const serviceAccount = require("./firebaseKey.json")
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})
const db = admin.firestore()

const app = express()
app.use(express.json())
app.use(
  cors({
    origin: ["http://localhost:5500", "http://127.0.0.1:3000", "https://lcnjoel.com"],
    credentials: true,
    methods: ["POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)

const handlingFeePercent = 0.03
const estimatedTaxPercent = 0.085
const fees = handlingFeePercent + estimatedTaxPercent

// Function to generate 8-character random alphanumeric key
function generateKey(length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let key = ""
  for (let i = 0; i < length; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}

// app.post("/create-checkout-session", async (req, res) => {
//   try {
//     const userId = req.body.user
//     const userName = req.body.userName
//     const pickup = req.body.pickup || null

//     // Generate unique key
//     const key = generateKey()

//     // ✅ Save session to Firestore
//     // await db.collection("checkout-sessions").add({
//     //   key,
//     //   createdAt: admin.firestore.FieldValue.serverTimestamp(),
//     // })

//     // ✅ Create an order document (pending)
//     const orderRef = await db.collection("orders").add({
//       userId,
//       userName,
//       pickup,
//       key,
//       products: req.body.items,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       status: "pending",
//     });

//     // ✅ Link order to user
//     await db.collection("users")
//   .doc(userId)
//   .collection("userOrders")
//   .add({
//     orderId: orderRef.id,
//     createdAt: admin.firestore.FieldValue.serverTimestamp(),
//   });





//     // ✅ Fetch products from Firestore to calculate prices
//     const snapshot = await db.collection("products").get()
//     const storeItems = new Map()
//     snapshot.forEach(doc => {
//       const data = doc.data()
//       storeItems.set(doc.id, {
//         priceInCents: data.price + Math.round(data.price * fees),
//         name: data.name,
//         img: data.img,
//       })
//     })

//     // ✅ Build Stripe session
//     const session = await stripe.checkout.sessions.create({
//       payment_method_types: ["card"],
//       mode: "payment",
//       line_items: req.body.items.map(item => {
//         const storeItem = storeItems.get(item.id)
//         if (!storeItem) throw new Error(`Product ${item.id} not found`)
//         return {
//           price_data: {
//             currency: "usd",
//             product_data: {
//               name: storeItem.name,
//               images: [storeItem.img],
//             },
//             unit_amount: storeItem.priceInCents,
//           },
//           quantity: item.quantity,
//         }
//       }),
//       success_url: `http://lcnjoel.com/jmbins/success.html?key=${key}`,
//       cancel_url: `http://lcnjoel.com/jmbins/index.html?canceled=true`,
//     })

//     res.json({ url: session.url })
//   } catch (e) {
//     console.error("Checkout error:", e)
//     res.status(500).json({ error: e.message })
//   }
// })


app.post("/create-donation-session", async (req, res) => {
  try {
    const { amount, recurring, userId, email } = req.body;

    if (!userId) return res.status(400).json({ error: "Missing userId." });
    if (!amount || amount <= 0)
      return res.status(400).json({ error: "Invalid donation amount." });

    const amountInCents = Math.round(amount * 100);

    // Get or create Stripe customer for this user
    const customerId = await getOrCreateCustomer(userId, email);

    let session;

    if (recurring) {
      // Recurring Donation (Subscription)
      const price = await stripe.prices.create({
        unit_amount: amountInCents,
        currency: "usd",
        recurring: { interval: "month" },
        product_data: { name: `Recurring Donation - $${amount}` },
      });

      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: "https://your-ministry-site.com/success",
        cancel_url: "https://your-ministry-site.com/cancel",
      });
    } else {
      // One-Time Donation
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `One-Time Donation - $${amount}` },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        success_url: "https://your-ministry-site.com/success",
        cancel_url: "https://your-ministry-site.com/cancel",
      });
    }

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe session error:", err.message);
    res.status(500).json({ error: "Failed to create Stripe session." });
  }
});

// ✅ Cancel Recurring Donation
app.post("/cancel-subscription", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "Missing userId." });

    const ref = doc(db, "stripe_customers", userId);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists())
      return res.status(404).json({ error: "User not found in database." });

    const { customerId } = snapshot.data();

    // List active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0)
      return res
        .status(404)
        .json({ error: "No active recurring donations found." });

    const subId = subscriptions.data[0].id;

    // Cancel it
    await stripe.subscriptions.cancel(subId);

    res.json({ success: true, message: "Recurring donation canceled." });
  } catch (err) {
    console.error("Cancel subscription error:", err.message);
    res.status(500).json({ error: "Failed to cancel subscription." });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
