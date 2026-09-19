require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const path = require("path");

// =====================================================
// MODELS
// =====================================================

const Car = require("./models/Car");
const Booking = require("./models/Booking");
const Notification = require("./models/Notification");

// =====================================================
// ROUTES
// =====================================================

const contactRoutes = require("./routes/contact");
const authRoutes = require("./routes/auth");
const carRoutes = require("./routes/carRoutes");
const bookingRoutes = require("./routes/booking");
const notificationRoutes = require("./routes/notification");

// =====================================================
// APP CONFIGURATION
// =====================================================

const app = express();
const PORT = process.env.PORT || 5500;
const dbUrl = process.env.ATLASDB_URL;

// =====================================================
// ENVIRONMENT CHECK
// =====================================================

if (!dbUrl) {
    console.error("ATLASDB_URL is missing in .env file");
    process.exit(1);
}

if (!process.env.SESSION_SECRET) {
    console.error("SESSION_SECRET is missing in .env file");
    process.exit(1);
}

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// EJS SETUP
// =====================================================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// =====================================================
// STATIC FILES
// =====================================================

app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// SESSION CONFIGURATION
// =====================================================

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
            mongoUrl: dbUrl,
            dbName: "ridewave"
        }),
        cookie: {
            maxAge: 24 * 60 * 60 * 1000
        }
    })
);

// =====================================================
// GLOBAL LOGIN STATUS
// =====================================================

app.use((req, res, next) => {
    res.locals.isLoggedIn = !!req.session.userId;
    next();
});

// =====================================================
// API ROUTES
// =====================================================

app.use("/api/bookings", bookingRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/cars", carRoutes);
app.use("/api/notifications", notificationRoutes);

// =====================================================
// STATIC VIEW ROUTES
// =====================================================

app.get("/teams", (req, res) => {
    res.render("teams");
});

app.get("/booking", (req, res) => {
    res.render("booking", {
        car: req.query.car || ""
    });
});

app.get("/test", (req, res) => {
    res.send("RideWave Backend Working!");
});

app.get("/", (req, res) => {
    res.render("index");
});

app.get("/search", (req, res) => {
    res.render("search", {
        query: req.query.q || ""
    });
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.get("/signup", (req, res) => {
    res.render("signup");
});

// ================= BLOG =================
app.get("/blog", (req, res) => {
    res.render("blog");
});

// contact
app.get("/contact", (req, res) => {
    res.render("contact");
});

app.get("/carAdmin", (req, res) => {
    res.render("carAdmin");
});

app.get(["/booking-confirm", "/bookingConform"], (req, res) => {
    res.render("bookingConform");
});

app.get("/Mybookings", (req, res) => {
    res.render("Mybooking");
});
app.get("/privacy", (req, res) => {
    res.render("privacy");
});
app.get("/refunds", (req, res) => {
    res.render("refunds");
});


app.get("/cookies", (req, res) => {
    res.render("cookies");
});



// BLOG 1
app.get("/blog/rental-tips-2026", (req, res) => {
    res.render("blog-rental-tips");
});

// BLOG 2
app.get("/blog/choose-right-rental-car", (req, res) => {
    res.render("blog-choose-car");
});

// BLOG 3
app.get("/blog/things-to-check-before-renting", (req, res) => {
    res.render("blog-check-before-renting");
});

// =====================================================
// PAYMENT PAGE
// =====================================================

app.get("/payment", (req, res) => {
    res.render("payment", {
        bookingId: req.query.booking || ""
    });
});

// =====================================================
// PAYMENT SUCCESS PAGE (FIRST-TO-PAY AUTO CANCEL LOGIC)
// =====================================================

app.get("/payment-success", async (req, res) => {
    try {
        const bookingId = req.query.booking || "";
        const paymentMethod = req.query.method || "Online";
        const upiApp = req.query.app || "";

        // ---------------------------------------------
        // 1. CHECK LOGIN & BOOKING ID
        // ---------------------------------------------
        if (!req.session.userId) {
            return res.redirect("/login");
        }

        if (!bookingId) {
            return res.redirect("/");
        }

        // ---------------------------------------------
        // 2. FIND BOOKING
        // ---------------------------------------------
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.redirect("/Mybookings");
        }

        // ---------------------------------------------
        // 3. SECURITY CHECK: ONLY RENTER CAN PAY
        // ---------------------------------------------
        if (
            !booking.renter ||
            booking.renter.toString() !== req.session.userId.toString()
        ) {
            return res.status(403).send(
                "You are not allowed to make payment for this booking."
            );
        }

        // ---------------------------------------------
        // 4. CHECK BOOKING STATUS
        // ---------------------------------------------
        if (booking.status !== "confirmed") {
            return res.status(400).send(
                "This booking is not confirmed yet."
            );
        }

        // ---------------------------------------------
        // 5. FIRST-TO-PAY RACE CONDITION CHECK
        // Agar kisi aur ne pehle pay kar diya ho
        // ---------------------------------------------
        const alreadyPaidBooking = await Booking.findOne({
            _id: { $ne: booking._id },
            car: booking.car,
            status: "confirmed",
            "payment.status": { $regex: /^paid$/i },
            startDate: { $lt: booking.endDate },
            endDate: { $gt: booking.startDate }
        });

        if (alreadyPaidBooking) {
            // Is user ki booking cancel mark karo
            booking.status = "cancelled";
            booking.note = "Slot booked by another customer who completed payment first.";
            await booking.save();

            return res.render("bookingConform", {
                errorMessage: "Sorry, this car was just booked and paid for by another customer."
            });
        }

        const amount = Number(booking.totalAmount) || 0;

        // ---------------------------------------------
        // 6. UPDATE PAYMENT STATUS TO 'PAID'
        // ---------------------------------------------
        if (!booking.payment) {
            booking.payment = {};
        }

        const wasAlreadyPaid = (booking.payment.status === "Paid");

        booking.payment.status = "Paid";
        booking.payment.method = paymentMethod;
        booking.payment.amountPaid = amount;
        booking.payment.amountRemaining = 0;

        await booking.save();

        const car = await Car.findById(booking.car);
        const carName = car && car.name ? car.name : "your car";

        // ---------------------------------------------
        // 7. AUTO-CANCEL OVERLAPPING BOOKINGS
        // (Sirf pehli baar pay hone par trigger karo)
        // ---------------------------------------------
        if (!wasAlreadyPaid) {
            const overlappingBookings = await Booking.find({
                _id: { $ne: booking._id },
                car: booking.car,
                status: { $in: ["pending", "confirmed"] },
                startDate: { $lt: booking.endDate },
                endDate: { $gt: booking.startDate }
            });

            for (const otherBooking of overlappingBookings) {
                otherBooking.status = "cancelled";
                otherBooking.note = "Auto-cancelled: Another customer completed payment first.";
                await otherBooking.save();

                if (otherBooking.renter) {
                    await Notification.create({
                        user: otherBooking.renter,
                        booking: otherBooking._id,
                        message: `Your booking for ${carName} was automatically cancelled because another customer completed payment first.`,
                        type: "booking_auto_cancelled"
                    }).catch(err => console.error("Notification Warning:", err));
                }
            }

            // Customer Notification
            await Notification.create({
                user: booking.renter,
                booking: booking._id,
                message: `Payment successful for your booking of ${carName}.`,
                type: "payment_success"
            }).catch(err => console.error(err));

            // Owner Notification
            await Notification.create({
                user: booking.owner,
                booking: booking._id,
                message: `Payment received for the booking of ${carName}.`,
                type: "payment_received"
            }).catch(err => console.error(err));
        }

        // ---------------------------------------------
        // 8. RENDER SUCCESS PAGE
        // ---------------------------------------------
        return res.render("payment-success", {
            bookingId,
            amount: amount.toLocaleString("en-IN"),
            paymentMethod,
            upiApp
        });

    } catch (error) {
        console.error("Payment Success Route Error:", error);
        return res.redirect("/");
    }
});

// =====================================================
// CUSTOMER BOOKING PAGE
// =====================================================

app.get("/Customerbooking", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect("/login");
        }

        const ownerId = new mongoose.Types.ObjectId(req.session.userId);

        const userCars = await Car.find({ owner: ownerId });
        const carIds = userCars.map(car => car._id);

        const bookings = await Booking.find({
            car: { $in: carIds }
        })
            .populate("car")
            .populate("renter", "name email")
            .sort({ createdAt: -1 });

        res.render("Customerbooking", { bookings });

    } catch (err) {
        console.error("Customerbooking Error:", err);
        res.render("Customerbooking", { bookings: [] });
    }
});

// =====================================================
// ADMIN DASHBOARD
// =====================================================

app.get("/admin", async (req, res) => {
    try {
        const userId = req.session?.userId;
        if (!userId) {
            return res.redirect("/login");
        }

        const ownerId = new mongoose.Types.ObjectId(userId);

        const userCars = await Car.find({ owner: ownerId }).sort({ createdAt: -1 });

        const categories = [
            ...new Set(userCars.map(car => car.category).filter(Boolean))
        ];

        const totalPrice = userCars.reduce(
            (sum, car) => sum + (Number(car.pricePerDay) || 0),
            0
        );

        const avg = userCars.length > 0 ? Math.round(totalPrice / userCars.length) : 0;
        const userCarIds = userCars.map(car => car._id);

        let pendingCount = await Booking.countDocuments({
            car: { $in: userCarIds },
            status: "pending"
        });

        let recentBookings = await Booking.find({
            car: { $in: userCarIds }
        })
            .populate("car")
            .populate("renter", "name email")
            .sort({ createdAt: -1 })
            .limit(5);

        if (recentBookings.length === 0) {
            pendingCount = await Booking.countDocuments({ status: "pending" });
            recentBookings = await Booking.find()
                .populate("car")
                .populate("renter", "name email")
                .sort({ createdAt: -1 })
                .limit(5);
        }

        res.render("admin", {
            totalCars: userCars.length,
            totalCategories: categories.length,
            avgPrice: avg,
            pendingBookingsCount: pendingCount,
            recentBookings
        });

    } catch (error) {
        console.error("Admin Route Error:", error);
        res.status(500).send("Dashboard Error: " + error.message);
    }
});

app.get("/confirmationPage", (req, res) => {
    res.render("confirmationPage", {
        bookingId: req.query.booking || ""
    });
});


// =====================================================
// MONGODB + SERVER START
// =====================================================

async function main() {
    try {
        await mongoose.connect(dbUrl, { dbName: "ridewave" });
        console.log("MongoDB Atlas Connected Successfully!");

        app.listen(PORT, () => {
            console.log(`CAR-RENTALS server running at http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
    }
}

main();