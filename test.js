// update-emoji.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load } from 'cheerio';

// Determine __dirname in ESM:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMOJI_TEST_URL = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';
const OUTPUT_FILE = path.join(__dirname, 'emoji-2db.json');

// --- Utility Functions ---

// Map Unicode group to our category (example mapping)
function mapGroupToCategory(group) {
    if (group.toLowerCase().includes('smileys')) {
        return 'Emoji & People';
    }
    return group;
}

// Format subgroup to title-case (e.g. "face-affection" → "Face Affection")
function formatSubCategory(subgroup) {
    return subgroup
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Convert title into a URL-friendly slug.
// Remove any leading prefix like "E1.0 " or "E0.6 " from the title.
function titleToSlug(title) {
    // Remove leading "E" followed by digits, optional dot and digits, then optional dash/whitespace.
    title = title.replace(/^e\d+(\.\d+)?[-\s]*/i, '');
    return title
        .toLowerCase()
        .replace(/['']/g, '') // remove apostrophes
        .replace(/\s+/g, '-')  // replace spaces with dash
        .replace(/[^a-z0-9\-]+/g, '') // remove any non-alphanumeric/dash characters
        .replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
}

// --- Parse the Unicode emoji-test.txt ---
function parseEmojiTest(text) {
    const lines = text.split('\n');
    let group = '';
    let subgroup = '';
    const emojis = [];
    for (const line of lines) {
        if (line.startsWith('# group:')) {
            group = line.replace('# group:', '').trim();
            continue;
        }
        if (line.startsWith('# subgroup:')) {
            subgroup = line.replace('# subgroup:', '').trim();
            continue;
        }
        if (line.trim() === '' || line.startsWith('#')) {
            continue;
        }
        // Expected format:
        // "1F601                                      ; fully-qualified     # 😁 Grinning Face With Big Eyes"
        const parts = line.split(';');
        if (parts.length < 2) continue;
        const codePart = parts[0].trim();
        const [status, comment] = parts[1].split('#').map(s => s.trim());
        if (status !== 'fully-qualified') continue;
        const spaceIndex = comment.indexOf(' ');
        const emojiChar = comment.substring(0, spaceIndex);
        const title = comment.substring(spaceIndex).trim();
        const obj = {
            category: mapGroupToCategory(group),
            sub_category: formatSubCategory(subgroup),
            code: codePart.toLowerCase(),
            emoji: emojiChar,
            title: title.replace(/^e\d+(\.\d+)?[-\s]*/i, ''), // ✅ Remove Unicode version
            aliases: [],
            shortcodes: { cldr: [], github: [], slack: [], discord: [] },
            tags: [],
            codepoints: [`U+${codePart.toUpperCase()}`],
            image: {}
        };

        emojis.push(obj);
    }
    return emojis;
}

// --- Fetch additional details from Emojipedia ---
// (Scraping logic based on current Emojipedia structure; adjust selectors as needed.)
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEmojiDetails(emojiObj) {
    const slug = titleToSlug(emojiObj.title);
    const url = `https://emojipedia.org/${emojiObj.emoji}/`;
    let attempts = 0;
    const maxAttempts = 5;
    const retryDelay = 3000; // 3 seconds

    while (attempts < maxAttempts) {
        try {
            console.log(`Fetching emoji details from: ${url} (Attempt ${attempts + 1})`);
            const res = await fetch(url);
            if (!res.ok) {
                console.warn(`Could not fetch details for "${emojiObj.title}" at ${url} - Status: ${res.status}`);
                return emojiObj;
            }
            const html = await res.text();
            const $ = load(html);
            let NEXT_PROPS = JSON.parse($("#__NEXT_DATA__").text()).props.pageProps.dehydratedState.queries;

            if (!NEXT_PROPS[3]?.state?.data) {
                console.log(`Data not found on attempt ${attempts + 1}. Retrying in ${retryDelay / 1000} seconds...`);
                attempts++;
                fs.writeFileSync("./tft/" + slug + ".html", html)
                if (attempts < maxAttempts) {
                    await delay(retryDelay);
                }
            } else {
                NEXT_PROPS = NEXT_PROPS[3].state.data;
                emojiObj.aliases = NEXT_PROPS.alsoKnownAs || [];
                if (NEXT_PROPS.currentCldrName !== NEXT_PROPS.appleName) {
                    emojiObj.aliases.push(NEXT_PROPS.appleName);
                }
                emojiObj.shortcodes = NEXT_PROPS.shortcodes?.reduce((acc, { code, source }) => {
                    acc[source] = acc[source] || [];
                    acc[source].push(code);
                    return acc;
                }, {}) || {};
                // console.log()
                // fs.writeFileSync("t.json", JSON.stringify(JSON.parse($("#__NEXT_DATA__").text()), null, 2))
                let v = NEXT_PROPS.vendorsAndPlatforms[0];
                emojiObj.image = { brand: v.slug, platform: [v.items[0].title, v.title], source: v.items[0].image.source };
                emojiObj.code = NEXT_PROPS.codepointsHex.join("-").replaceAll("U+", "").toLowerCase();
                emojiObj.emoji = NEXT_PROPS.code;
                return emojiObj;
            }
        } catch (err) {
            console.error(`Error fetching details for "${emojiObj.title}" on attempt ${attempts + 1}:`, err);
            attempts++;
            if (attempts < maxAttempts) {
                console.log(`Retrying in ${retryDelay / 1000} seconds...`);
                await delay(retryDelay);
            }
        }
    }

    console.error(`Failed to fetch details for "${emojiObj.title}" after ${maxAttempts} attempts.`);
    return emojiObj;
}


// --- Main update function ---
async function updateEmojiDatabase() {
    try {
        console.log('Fetching Unicode emoji data...');
        const response = await fetch(EMOJI_TEST_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch emoji test file: ${response.status}`);
        }
        const text = await response.text();
        console.log('Parsing emoji data...');
        const emojis = parseEmojiTest(text);
        console.log(`Parsed ${emojis.length} emojis. Fetching additional details from Emojipedia...`);

        // For demonstration, process a subset (e.g. first 3 emojis)
        const updatedEmojis = [];
        for (const emojiObj of emojis) {
            console.log(`========================================`);
            console.log(`Processing "${emojiObj.title}" (${emojiObj.emoji})...`);
            console.log(`========================================`);
            const detailedEmoji = await fetchEmojiDetails(emojiObj);
            updatedEmojis.push(detailedEmoji);
            console.log(`Waiting before next request...`);
            // await new Promise(r => setTimeout(r, 1000));
        }

        console.log('Writing results to file...');
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(updatedEmojis, null, 2), 'utf-8');
        console.log(`Emoji database updated. Output written to ${OUTPUT_FILE}`);
        console.log(`Processed ${updatedEmojis.length} emojis.`);
    } catch (err) {
        console.error('Error updating emoji database:', err);
        console.error(err.stack);
    }
}

updateEmojiDatabase();