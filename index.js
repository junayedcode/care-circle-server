import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import cors from 'cors'
import express from "express";
import 'dotenv/config'

const app = express()
const port = 8000
app.use(cors())
app.use(express.json())


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

 const mongoclient=await  connectToMongoDB()
 const db = mongoclient.db("create-event")
 const eventCollection = db.collection("Events")

http://localhost:8000/
app.get('/', (req, res) => {
  res.send({ message:'Hello World!'})
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
http://localhost:8000/create-event
app.post('/create-event', async(req,res)=>{
 const data = req.body
  const result = await eventCollection.insertOne(data)
  console.log(result);
 res.send(result)
})

app.get('/events',async(req,res)=>{
  const result =await eventCollection.find().toArray()
  res.send(result)
})