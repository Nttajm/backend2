require("dotenv").config()
const express = require("express")
const cors = require("cors")
const stripe = require("stripe")(process.env.STRIPE_TEST_KEY)
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
    origin: ["http://localhost:5500", "http://127.0.0.1:3000", "http://lcnjoel.com"],
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

app.post("/create-checkout-session", async (req, res) => {
  try {
    const userId = req.body.user
    const userName = req.body.userName
    const pickup = req.body.pickup || null

    // Generate unique key
    const key = generateKey()

    // ✅ Save session to Firestore
    // await db.collection("checkout-sessions").add({
    //   key,
    //   createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // })

    // ✅ Create an order document (pending)
    const orderRef = await db.collection("orders").add({
      userId,
      userName,
      pickup,
      key,
      products: req.body.items,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending",
    });

    // ✅ Link order to user
    await db.collection("users")
  .doc(userId)
  .collection("userOrders")
  .add({
    orderId: orderRef.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });





    // ✅ Fetch products from Firestore to calculate prices
    const snapshot = await db.collection("products").get()
    const storeItems = new Map()
    snapshot.forEach(doc => {
      const data = doc.data()
      storeItems.set(doc.id, {
        priceInCents: data.price + Math.round(data.price * fees),
        name: data.name,
        img: data.img,
      })
    })

    // ✅ Build Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: req.body.items.map(item => {
        const storeItem = storeItems.get(item.id)
        if (!storeItem) throw new Error(`Product ${item.id} not found`)
        return {
          price_data: {
            currency: "usd",
            product_data: {
              name: storeItem.name,
              images: [storeItem.img],
            },
            unit_amount: storeItem.priceInCents,
          },
          quantity: item.quantity,
        }
      }),
      success_url: `http://127.0.0.1:3000/success.html?key=${key}`,
      cancel_url: `http://127.0.0.1:3000?canceled=true`,
    })

    res.json({ url: session.url })
  } catch (e) {
    console.error("Checkout error:", e)
    res.status(500).json({ error: e.message })
  }
})

app.listen(3005, () => console.log("Server running on port 3005"))
