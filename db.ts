
import { Db, Collection, MongoClient, ObjectId, Binary } from 'mongodb';
import { nanoid } from 'nanoid';

type User = {
  _id: number,
  firstName: string,
  lastName: string,
  username: string,
  photo: Binary,
  photoId: string,
  photoTs: number,
  premium: boolean,
  locale: string,
  theme: string,
  gifts: number,
}
type Gift = {
  _id: ObjectId,
  order: number,
  image: string,
  color: string,
  name: Object,
  price: number,
  asset: string,
  total: number,
  sold: number,
  anim: string,
}
type Action = {
  _id: ObjectId,
  code: string,
  date: Date,
  type: 'invoice' | 'buy' | 'send' | 'receive',
  giftId: ObjectId,
  userId: number,
  invoiceId: number,
  senderId: number,
  receiverId: number,
  inlineId: string,
  price: number,
  asset: string,
}

const pageSize: number = 24;
const userProjection = {
  firstName: 1,
  lastName: 1,
  gifts: 1,
  premium: 1,
  hasPhoto: {
    $and: [
      { $ne: [{ '$type': '$photo' }, 'missing'] },
      { $ne: ['$photo', null] }
    ],
  },
}
const actionProjection = {
  date: 1,
  type: 1,
  userId: 1,
  sendId: 1,
  senderId: 1,
  receiveId: 1,
  receiverId: 1,
  giftId: 1,
  price: 1,
  asset: 1,
}
let db: Db, client: MongoClient, gifts: Collection, users: Collection, actions: Collection;

export async function initDb() {
  const mongo: MongoClient = new MongoClient(`mongodb://${process.env.MONGO_HOST}/`);
  client = await mongo.connect();
  db = client.db(process.env.MONGO_DB);
  gifts = db.collection('gifts');
  users = db.collection('users');
  actions = db.collection('actions');
}

export async function upsertUser(bot, user) {
  const result: User = (await users.findOneAndUpdate(
    { _id: user.id },
    {
      $set: {
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        premium: !!user.is_premium
      },
      $setOnInsert: { // Do not override if user changed it
        locale: user.language_code?.startsWith('ru') ? 'ru' : 'en',
        theme: null,
        gifts: 0,
      },
    },
    { upsert: true, returnDocument: 'after' }
  )) as any;

  if (!result.photoTs || Date.now() - result.photoTs > 30 * 60 * 1000) {
    // Time to refresh userpic (note: this is a longer operation, it won't affect current result)
    users.updateOne({ _id: user.id }, { $set: { photoTs: Date.now() }}).then(async () => {
      const chat = await bot.getChat({ chat_id: user.id });
      if (result.photoId == chat.photo?.small_file_id) {
        // Not changed
        return;
      }
      if (!chat.photo?.small_file_id) {
        // Empty photo
        users.updateOne({ _id: user.id }, { $set: { photoId: null, photo: null } });
        return;
      }
      // Store big photo as well?
      const file = await bot.getFile({ file_id: chat.photo.small_file_id });
      users.updateOne({ _id: user.id }, { $set: {
        photoId: chat.photo.small_file_id,
        photo: Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`)).arrayBuffer()),
      } });
    });
  }
  return result;
}
export async function insertInvoice(userId, invoiceId, giftId, price, asset) {
  return actions.insertOne({
    date: new Date(),
    type: 'invoice',
    userId, invoiceId, giftId, price, asset,
  });
}
export async function updateInvoicePaid(invoiceId) {
  const code: string = nanoid(16);
  const action = await actions.findOneAndUpdate({ invoiceId }, { $set: {
    type: 'buy',
    code,
  } }, { returnDocument: 'after' });
  if (!action) {
    return null;
  }
  await gifts.updateOne({ _id: action.giftId }, { $inc: { sold: 1 }});
  return findReadyToSendGift(code);
}
export async function updateGiftSent(id: string, inlineId: string) {
  return await actions.findOneAndUpdate({ _id: ObjectId.createFromHexString(id), type: 'buy', sendId: null, receiveId: null, inlineId: null }, { $set: {
    inlineId,
  } }, { returnDocument: 'after' });
}
export async function updateGiftReceived(code: string, userId: number) {
  const date: Date = new Date();
  // First, pre-check
  const before = await actions.findOne({ code, type: 'buy' }, { projection: actionProjection });
  if (!before) {
    return { error: 'GiftNotFound' };
  }
  if (before.receiverId == userId) {
    return null; // Not an error; just a refresh of a gift we already received
  }
  if (before.receiverId) {
    return { error: 'GiftAlreadyReceived' };
  }
  if (before.userId == userId) {
    return { error: 'GiftOwn' };
  }
  // Next, prevent double-updates
  const after = await actions.findOneAndUpdate({ _id: before._id, code, type: 'buy', receiverId: null }, { $set: {
    receiverId: userId,
  } }, { returnDocument: 'after' });
  if (!after) {
    return { error: 'GiftAlreadyReceived' };
  }
  // Then, add send/receive actions
  const sendId = (await actions.insertOne({
    date,
    type: 'send',
    userId: before.userId,
    giftId: before.giftId,
    buyId: before._id,
    receiverId: userId,
  })).insertedId;
  const receiveId = (await actions.insertOne({
    date,
    type: 'receive',
    userId,
    giftId: before.giftId,
    buyId: before._id,
    senderId: before.userId,
  })).insertedId;
  // Finally, set sendId/receiveId and retrieve final state
  const buy = await actions.findOneAndUpdate({ _id: before._id, type: 'buy' }, { $set: {
    sendId,
    receiveId,
  } }, { returnDocument: 'after' });
  // Increment gift counter
  await users.updateOne({ _id: userId as any }, { $inc: { gifts: 1 }});
  // And return the receive action
  const receive = (await findActions({ _id: receiveId }))[0];
  return { buy, receive };
}
export async function findAllGifts(): Promise<Gift[]> {
  return (await gifts.find().sort('order', 'asc')).toArray() as Promise<any[]>;
}
export function findStoreGift(giftId: string) {
  return gifts.findOne({ _id: ObjectId.createFromHexString(giftId) });
}
export function findUser(id: number) {
  return users.findOne({ _id: id as any }, { projection: {
    ...userProjection,
    locale: 1,
    theme: 1,
  } });
}
export function updateUser(id: number, update: Object) {
  return users.updateOne({ _id: id as any }, { $set: update });
}
export async function findUserPhoto(id: number): Promise<Binary> {
  return (await users.findOne({ _id: id as any }, { projection: ['photo'] }))?.photo;
}
export async function findTopUsers(): Promise<User[]> {
  return (await users.find({}, { projection: userProjection }).sort('gifts', 'desc').limit(100)).toArray() as Promise<any[]>;
}
export async function findUsers(ids: number[]): Promise<User[]> {
  return (await users.find({ _id: { $in: ids as any }}, { projection: userProjection }).sort('gifts', 'desc').limit(100)).toArray() as Promise<any[]>;
}
export async function findUsersByName(name: string, offs: number = 0): Promise<User[]> {
  return (await users.find({
    $or: [
      { firstName: { $regex: name, $options: '$i' } },
      { lastName: { $regex: name, $options: '$i' } },
      { username: { $regex: name, $options: '$i' } },
    ]
  }, { projection: userProjection }).sort('gifts', 'desc').skip(offs).limit(100)).toArray() as Promise<any[]>;
}
export function findPosition(user): Promise<number> {
  return users.countDocuments({ gifts: { $gt: user.gifts || 0 } });
}
export async function findReadyToSendGift(code: string): Promise<Action> {
  return actions.findOne({ code, type: 'buy', sendId: null, receiveId: null, inlineId: null }, { projection: { ...actionProjection, code: 1 } }) as any;
}
export async function findInventory(userId: number, offs: number = 0): Promise<Action[]> {
  return (await actions.find({ userId, type: 'buy', sendId: null, receiveId: null, inlineId: null }, { projection: { ...actionProjection, code: 1 } }).sort('_id', 'desc').skip(offs).limit(pageSize)).toArray() as Promise<any[]>;
}
async function findActions(query, offs: number = 0): Promise<Action[]> {
  const list: any[] = await (await actions.find(query, { projection: actionProjection }).sort('_id', 'desc').skip(offs).limit(pageSize)).toArray();
  if (list.length) {
    const users = await findUsers([...new Set(
      list.map(action => action.userId).filter(id => !!id).concat(
        list.map(action => action.senderId).filter(id => !!id),
        list.map(action => action.receiverId).filter(id => !!id),
      ))]);
    const usersMap = Object.fromEntries(users.map(user => [user._id, user]));
    for (const action of list) {
      action.userId && (action['user'] = usersMap[action.userId]);
      action.senderId && (action['sender'] = usersMap[action.senderId]);
      action.receiverId && (action['receiver'] = usersMap[action.receiverId]);
    }
  }
  return list;
}
export function findReceivedGifts(id: number, offs: number = 0): Promise<Action[]> {
  return findActions({ userId: id, type: 'receive' }, offs);
}
export function findRecentActions(id: number, offs: number = 0): Promise<Action[]> {
  return findActions({ userId: id, type: { $in: ['buy', 'send', 'receive'] } }, offs);
}
export function findGiftActions(gift: string, offs: number = 0): Promise<Action[]> {
  return findActions({ giftId: ObjectId.createFromHexString(gift), type: { $in: ['buy', 'send'] } }, offs);
}