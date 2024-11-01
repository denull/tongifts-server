import path from 'path';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const mongo = new MongoClient(`mongodb://${process.env.MONGO_HOST}/`);
mongo.connect().then(async client => {
  const db = client.db(process.env.MONGO_DB);
  const gifts = db.collection('gifts');
  const users = db.collection('users');
  const actions = db.collection('actions');
  await gifts.createIndex({ order: 1 });
  await users.createIndex({ gifts: -1 });
  await actions.createIndex({ type: 1, userId: 1, receiverId: 1, giftId: 1 });
  console.log('Done');
  await mongo.close();
  process.exit();
});