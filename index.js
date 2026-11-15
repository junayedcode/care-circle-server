import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import cors from 'cors';
import express from "express";
import 'dotenv/config';

const app = express();
const port = 8000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URL);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoclient = await connectToMongoDB();
const db = mongoclient.db("create-event");
const eventCollection = db.collection("Events");

// 1. Root Route Check
app.get('/', (req, res) => {
  res.send({ message: 'Hello World!' });
});

// 2. Route to Create a New Event
app.post('/create-event', async (req, res) => {
  try {
    const data = req.body;
    const result = await eventCollection.insertOne(data);
    res.send({ success: true, result });
  } catch (error) {
    res.status(500).send({ error: "Failed to create event" });
  }
});

app.post("/events", async (req, res) => {
  try {
    const newEvent = req.body;
    const result = await eventCollection.insertOne(newEvent);
    res.send({ success: true, result });
  } catch (error) {
    res.status(500).send({ error: "Failed to create event" });
  }
});

// 3. Route to Fetch All Events
app.get('/events', async (req, res) => {
  try {
    const result = await eventCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch events" });
  }
});

// 4. Route to Fetch Organizer's Events (Returns all if email is not provided to prevent missing data)
app.get("/events/organizer", async (req, res) => {
  try {
    const email = req.query.email;
    const query = email ? { organizerEmail: email } : {};
    const result = await eventCollection.find(query).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch organizer events" });
  }
});

// 5. Route to Fetch Events Joined by a User
app.get("/events/joined", async (req, res) => {
  try {
    const userEmail = req.query.email;
    const query = { "volunteers.email": userEmail };
    const result = await eventCollection.find(query).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch joined events" });
  }
});

// 6. Route to Fetch Single Event Details by ID
app.get('/event/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await eventCollection.findOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch event details" });
  }
});

// 7. Route to Join an Event
app.post("/event/:id/join", async (req, res) => {
  try {
    const eventId = req.params.id;
    const { email, name, image } = req.body;

    const event = await eventCollection.findOne({ _id: new ObjectId(eventId) });
    if (!event) {
      return res.status(404).send({ message: "Event not found" });
    }

    const alreadyJoined = event.volunteers?.some((vol) => vol.email === email);
    if (alreadyJoined) {
      return res.status(400).send({ message: "You have already joined this event!" });
    }

    await eventCollection.updateOne(
      { _id: new ObjectId(eventId) },
      {
        $push: {
          volunteers: { email, name, image, joinedAt: new Date() },
        },
      }
    );

    res.send({ success: true, message: "Successfully joined the event!" });
  } catch (error) {
    res.status(500).send({ error: "Failed to join event" });
  }
});

// 8. Route to Leave an Event
app.post("/event/:id/leave", async (req, res) => {
  try {
    const eventId = req.params.id;
    const { email } = req.body;

    const result = await eventCollection.updateOne(
      { _id: new ObjectId(eventId) },
      {
        $pull: {
          volunteers: { email: email },
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).send({ message: "You are not joined in this event." });
    }

    res.send({ success: true, message: "Successfully left the event!" });
  } catch (error) {
    res.status(500).send({ error: "Failed to leave event" });
  }
});

// 9. Route to Update/Edit an Event
app.put("/event/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updatedEvent = req.body;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        title: updatedEvent.title,
        type: updatedEvent.type,
        date: updatedEvent.date,
        location: updatedEvent.location,
        thumbnail: updatedEvent.thumbnail,
        description: updatedEvent.description,
      },
    };
    const result = await eventCollection.updateOne(filter, updateDoc);
    res.send({ success: true, result });
  } catch (error) {
    res.status(500).send({ error: "Failed to update event" });
  }
});

// 10. Route to Delete an Event
app.delete("/event/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await eventCollection.deleteOne(query);
    res.send({ success: true, result });
  } catch (error) {
    res.status(500).send({ error: "Failed to delete event" });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});