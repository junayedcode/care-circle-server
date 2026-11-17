
import { MongoClient, ObjectId } from "mongodb";
import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 8000;

// CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
      : true,
    credentials: true,
  })
);

app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URL);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("MongoDB connection error:", err);
    return null;
  }
}

const mongoclient = await connectToMongoDB();

if (!mongoclient) {
  console.error("MongoDB connection failed — server cannot start.");
  process.exit(1);
}

// Database
const db = mongoclient.db("create-event");
const eventCollection = db.collection("Events");

const authSessionCollection = mongoclient
  .db("care-circle")
  .collection("session");

const authUserCollection = mongoclient
  .db("care-circle")
  .collection("user");

// Better Auth Session Verification
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

// Parse Cookies
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const idx = part.indexOf("=");

    if (idx === -1) continue;

    const name = part.slice(0, idx).trim();

    try {
      cookies[name] = decodeURIComponent(
        part.slice(idx + 1).trim()
      );
    } catch {
      cookies[name] = part.slice(idx + 1).trim();
    }
  }

  return cookies;
}

// Verify Better Auth Session
async function verifySession(req) {
  console.log("========== AUTH DEBUG ==========");

  console.log(
    "Cookie received:",
    req.headers.cookie ? "YES" : "NO"
  );

  console.log(
    "Cookie names:",
    req.headers.cookie
      ? req.headers.cookie
          .split(";")
          .map((c) => c.split("=")[0].trim())
      : "No cookies found"
  );

  const cookies = parseCookies(req);

  const raw = SESSION_COOKIE_NAMES
    .map((name) => cookies[name])
    .find(Boolean);

  console.log(
    "Session cookie found:",
    raw ? "YES" : "NO"
  );

  if (!raw) {
    console.log("AUTH RESULT: No session cookie");
    console.log("================================");
    return null;
  }

  const dotIndex = raw.lastIndexOf(".");

  if (dotIndex === -1) {
    console.log("AUTH RESULT: Invalid cookie format");
    console.log("================================");
    return null;
  }

  const token = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);

  if (process.env.BETTER_AUTH_SECRET) {
    const expected = crypto
      .createHmac("sha256", process.env.BETTER_AUTH_SECRET)
      .update(token)
      .digest("base64");

    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);

    if (
      given.length !== wanted.length ||
      !crypto.timingSafeEqual(given, wanted)
    ) {
      console.log("AUTH RESULT: Invalid signature");
      console.log("================================");
      return null;
    }
  }

  const session = await authSessionCollection.findOne({
    token,
  });

  if (!session) {
    console.log("AUTH RESULT: Session not found in MongoDB");
    console.log("================================");
    return null;
  }

  const expiresAt = new Date(session.expiresAt);

  if (
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= new Date()
  ) {
    console.log("AUTH RESULT: Session expired");
    console.log("================================");
    return null;
  }

  const user =
    (await authUserCollection.findOne({
      id: session.userId,
    })) ||
    (await authUserCollection.findOne({
      _id: session.userId,
    }));

  if (!user) {
    console.log("AUTH RESULT: User not found");
    console.log("================================");
    return null;
  }

  console.log("AUTH RESULT: SUCCESS");
  console.log("User authenticated:", user.email);
  console.log("================================");

  return { session, user };
}

// Authentication Middleware
async function requireAuth(req, res, next) {
  try {
    const auth = await verifySession(req);

    if (!auth) {
      return res.status(401).send({
        message: "You must be logged in to perform this action.",
      });
    }

    req.authUser = auth.user;
    next();
  } catch (error) {
    console.error("Session verification failed:", error);

    res.status(500).send({
      message: "Failed to verify session",
    });
  }
}

// 1. Root Route
app.get("/", (req, res) => {
  res.send({
    message: "Hello World!",
  });
});

// 2. Create Event
async function createEventHandler(req, res) {
  try {
    const {
      title,
      type,
      date,
      location,
      thumbnail,
      description,
    } = req.body;

    if (
      !title?.trim() ||
      !date?.trim() ||
      !location?.trim() ||
      !description?.trim()
    ) {
      return res.status(400).send({
        message:
          "Title, date, location and description are required.",
      });
    }

    const result = await eventCollection.insertOne({
      title: title.trim(),
      type: type || "Donation",
      date,
      location: location.trim(),
      thumbnail: thumbnail || "",
      description,
      organizerEmail: req.authUser.email,
      organizerName: req.authUser.name || "Organizer",
      organizerImage: req.authUser.image || "",
      volunteers: [],
      createdAt: new Date(),
    });

    res.send({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Failed to create event:", error);

    res.status(500).send({
      error: "Failed to create event",
    });
  }
}

app.post("/events", requireAuth, createEventHandler);
app.post("/create-event", requireAuth, createEventHandler);

// 3. Fetch All Events
app.get("/events", async (req, res) => {
  try {
    const result = await eventCollection
      .find()
      .sort({ date: 1 })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      error: "Failed to fetch events",
    });
  }
});

// 4. Fetch Organizer Events
app.get("/events/organizer", async (req, res) => {
  try {
    const email = req.query.email;

    const query = email
      ? { organizerEmail: email }
      : {};

    const result = await eventCollection
      .find(query)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      error: "Failed to fetch organizer events",
    });
  }
});

// 5. Fetch Joined Events
app.get("/events/joined", async (req, res) => {
  try {
    const userEmail = req.query.email;

    const query = {
      "volunteers.email": userEmail,
    };

    const result = await eventCollection
      .find(query)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      error: "Failed to fetch joined events",
    });
  }
});

// 6. Fetch Single Event
app.get("/event/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({
        error: "Event not found",
      });
    }

    const result = await eventCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({
        error: "Event not found",
      });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({
      error: "Failed to fetch event details",
    });
  }
});

// 7. Join Event
app.post("/event/:id/join", requireAuth, async (req, res) => {
  try {
    const eventId = req.params.id;

    if (!ObjectId.isValid(eventId)) {
      return res.status(404).send({
        message: "Event not found",
      });
    }

    const user = req.authUser;

    const event = await eventCollection.findOne({
      _id: new ObjectId(eventId),
    });

    if (!event) {
      return res.status(404).send({
        message: "Event not found",
      });
    }

    const capacity = Number(
      event.capacity ?? event.maxVolunteers
    );

    const currentCount = event.volunteers?.length || 0;

    if (
      Number.isFinite(capacity) &&
      capacity > 0 &&
      currentCount >= capacity
    ) {
      return res.status(409).send({
        message: "This event is already full.",
      });
    }

    const result = await eventCollection.updateOne(
      {
        _id: new ObjectId(eventId),
        "volunteers.email": {
          $ne: user.email,
        },
      },
      {
        $push: {
          volunteers: {
            email: user.email,
            name: user.name || "Volunteer",
            image: user.image || "",
            joinedAt: new Date(),
          },
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).send({
        message: "You have already joined this event!",
      });
    }

    res.send({
      success: true,
      message: "Successfully joined the event!",
    });
  } catch (error) {
    console.error("Join event error:", error);

    res.status(500).send({
      error: "Failed to join event",
    });
  }
});

// 8. Leave Event
app.post("/event/:id/leave", requireAuth, async (req, res) => {
  try {
    const eventId = req.params.id;

    if (!ObjectId.isValid(eventId)) {
      return res.status(404).send({
        message: "Event not found",
      });
    }

    const result = await eventCollection.updateOne(
      {
        _id: new ObjectId(eventId),
      },
      {
        $pull: {
          volunteers: {
            email: req.authUser.email,
          },
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).send({
        message: "You are not joined in this event.",
      });
    }

    res.send({
      success: true,
      message: "Successfully left the event!",
    });
  } catch (error) {
    console.error("Leave event error:", error);

    res.status(500).send({
      error: "Failed to leave event",
    });
  }
});

// 9. Update Event
app.put("/event/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({
        error: "Event not found",
      });
    }

    const event = await eventCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).send({
        error: "Event not found",
      });
    }

    if (event.organizerEmail !== req.authUser.email) {
      return res.status(403).send({
        message: "You are not allowed to edit this event.",
      });
    }

    const editableFields = [
      "title",
      "type",
      "date",
      "location",
      "thumbnail",
      "description",
    ];

    const updateDoc = {};

    for (const field of editableFields) {
      if (req.body[field] !== undefined) {
        updateDoc[field] = req.body[field];
      }
    }

    if (Object.keys(updateDoc).length === 0) {
      return res.status(400).send({
        message: "No valid fields to update.",
      });
    }

    const result = await eventCollection.updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: updateDoc,
      }
    );

    res.send({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Update event error:", error);

    res.status(500).send({
      error: "Failed to update event",
    });
  }
});

// 10. Delete Event
app.delete("/event/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({
        error: "Event not found",
      });
    }

    const event = await eventCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).send({
        error: "Event not found",
      });
    }

    if (event.organizerEmail !== req.authUser.email) {
      return res.status(403).send({
        message: "You are not allowed to delete this event.",
      });
    }

    const result = await eventCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Delete event error:", error);

    res.status(500).send({
      error: "Failed to delete event",
    });
  }
});

// Localhost + Vercel
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`CareCircle API listening on port ${port}`);

    console.log(
      `Session HMAC verification: ${
        process.env.BETTER_AUTH_SECRET
          ? "ENABLED"
          : "DISABLED"
      }`
    );
  });
}

export default app;
