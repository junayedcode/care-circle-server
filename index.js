
import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const port = process.env.PORT || 8000;

// ==========================================
// AUTH CONFIGURATION
// ==========================================

// Better Auth runs on the FRONTEND (Next.js).
// Local: http://localhost:3000
// Production: https://care-circle-navy-one.vercel.app

const AUTH_BASE_URL = (
  process.env.AUTH_BASE_URL || process.env.BETTER_AUTH_URL
)?.trim().replace(/\/+$/, "");

if (!AUTH_BASE_URL) {
  throw new Error("AUTH_BASE_URL is missing in .env");
}

let JWKS_URL;

try {
  JWKS_URL = new URL("/api/auth/jwks", AUTH_BASE_URL);
} catch {
  throw new Error(
    "Invalid AUTH_BASE_URL. Check your backend .env file."
  );
}

console.log("Auth Base URL:", AUTH_BASE_URL);
console.log("JWKS URL:", JWKS_URL.toString());

const JWKS = createRemoteJWKSet(JWKS_URL);

// ==========================================
// CORS CONFIGURATION
// ==========================================

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) =>
      origin.trim().replace(/\/+$/, "")
    )
  : ["http://localhost:3000"];

if (!allowedOrigins.includes(AUTH_BASE_URL)) {
  allowedOrigins.push(AUTH_BASE_URL);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("CORS blocked origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());

// ==========================================
// MONGODB CONNECTION
// ==========================================

const mongoUrl = process.env.MONGODB_URL;

if (!mongoUrl) {
  throw new Error("MONGODB_URL is missing");
}

const client = new MongoClient(mongoUrl);

await client.connect();

console.log("MongoDB connected successfully");

const db = client.db("create-event");
const eventCollection = db.collection("Events");

const authUserCollection = client
  .db("care-circle")
  .collection("user");

// ==========================================
// FIND AUTH USER
// ==========================================

async function findAuthUser(userId) {
  const conditions = [
    { id: userId },
    { _id: userId },
  ];

  if (ObjectId.isValid(userId)) {
    conditions.push({
      _id: new ObjectId(userId),
    });
  }

  return authUserCollection.findOne({
    $or: conditions,
  });
}

// ==========================================
// JWT AUTHENTICATION
// ==========================================

async function verifySession(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    console.log("AUTH DEBUG: Authorization header missing");
    return null;
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    console.log("AUTH DEBUG: Token is empty");
    return null;
  }

  try {
    // Verify JWT signature using Better Auth JWKS
    const { payload } = await jwtVerify(token, JWKS);

    console.log("AUTH DEBUG: JWT signature verified");
    console.log("AUTH DEBUG: Issuer:", payload.iss);
    console.log("AUTH DEBUG: Audience:", payload.aud);
    console.log("AUTH DEBUG: Subject:", payload.sub);

    // Check issuer
    if (payload.iss !== AUTH_BASE_URL) {
      console.log("AUTH DEBUG: Issuer mismatch");
      return null;
    }

    // Check subject
    if (!payload.sub) {
      console.log("AUTH DEBUG: Subject missing");
      return null;
    }

    // Find user in Better Auth database
    const user = await findAuthUser(payload.sub);

    if (!user) {
      console.log("AUTH DEBUG: User not found in MongoDB");
      return null;
    }

    console.log("AUTH DEBUG: User found successfully");

    return user;
  } catch (error) {
    console.error("AUTH DEBUG: JWT verification failed");
    console.error("Error:", error.name, error.message);

    return null;
  }
}

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

async function requireAuth(req, res, next) {
  try {
    console.log(
      "AUTH DEBUG: Request",
      req.method,
      req.originalUrl
    );

    const user = await verifySession(req);

    if (!user) {
      console.log("AUTH DEBUG: Authentication rejected");

      return res.status(401).send({
        message: "You must be logged in to perform this action.",
      });
    }

    req.authUser = user;

    console.log("AUTH DEBUG: Authentication successful");

    next();
  } catch (error) {
    console.error("AUTH DEBUG: Middleware error:", error);

    return res.status(500).send({
      message: "Authentication failed",
    });
  }
}

// ==========================================
// ROOT ROUTE
// ==========================================

app.get("/", (req, res) => {
  res.send({
    message: "CareCircle API is running!",
  });
});

// ==========================================
// CREATE EVENT
// ==========================================

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

    return res.send({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Create event error:", error);

    return res.status(500).send({
      error: "Failed to create event",
    });
  }
}

app.post("/events", requireAuth, createEventHandler);
app.post("/create-event", requireAuth, createEventHandler);

// ==========================================
// FETCH ALL EVENTS
// ==========================================

app.get("/events", async (req, res) => {
  try {
    const result = await eventCollection
      .find()
      .sort({ date: 1 })
      .toArray();

    res.send(result);
  } catch (error) {
    console.error("Fetch events error:", error);

    res.status(500).send({
      error: "Failed to fetch events",
    });
  }
});

// ==========================================
// FETCH ORGANIZER EVENTS
// ==========================================

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
    console.error("Organizer events error:", error);

    res.status(500).send({
      error: "Failed to fetch organizer events",
    });
  }
});

// ==========================================
// FETCH JOINED EVENTS
// ==========================================

app.get("/events/joined", async (req, res) => {
  try {
    const userEmail = req.query.email;

    const result = await eventCollection
      .find({
        "volunteers.email": userEmail,
      })
      .toArray();

    res.send(result);
  } catch (error) {
    console.error("Joined events error:", error);

    res.status(500).send({
      error: "Failed to fetch joined events",
    });
  }
});

// ==========================================
// FETCH SINGLE EVENT
// ==========================================

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
    console.error("Single event error:", error);

    res.status(500).send({
      error: "Failed to fetch event details",
    });
  }
});

// ==========================================
// JOIN EVENT
// ==========================================

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

// ==========================================
// LEAVE EVENT
// ==========================================

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

// ==========================================
// UPDATE EVENT
// ==========================================

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

// ==========================================
// DELETE EVENT
// ==========================================

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

// ==========================================
// LOCAL DEVELOPMENT & VERCEL
// ==========================================

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`CareCircle API listening on port ${port}`);
  });
}

export default app;
