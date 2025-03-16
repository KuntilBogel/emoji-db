import * as EmojiDbLib from '../src/emoji-db.js';
console.log(EmojiDbLib)
const emojiDb = new EmojiDbLib.default({ useDefaultDb: true })
const emojis = emojiDb.searchFromText({ input: "🫩 a", fixCodePoints: true })
console.log(emojis)