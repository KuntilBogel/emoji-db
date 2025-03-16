import axios from 'axios';
import { load } from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Determine __dirname in ESM:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMOJI_TEST_URL = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';
const OUTPUT_FILE = path.join(__dirname, 'emoji-2db.json');

// --- Utility Functions ---

function mapGroupToCategory(group) {
  return group.toLowerCase().includes('smileys') ? 'Emoji & People' : group;
}

function formatSubCategory(subgroup) {
  return subgroup
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function titleToSlug(title) {
  title = title.replace(/^e\d+(\.\d+)?[-\s]*/i, '');
  return title
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]+/g, '')
    .replace(/^-+|-+$/g, '');
}

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
    if (line.trim() === '' || line.startsWith('#')) continue;
    const parts = line.split(';');
    if (parts.length < 2) continue;
    const codePart = parts[0].trim();
    const [status, comment] = parts[1].split('#').map(s => s.trim());
    if (status !== 'fully-qualified') continue;
    const spaceIndex = comment.indexOf(' ');
    const emojiChar = comment.substring(0, spaceIndex);
    const title = comment.substring(spaceIndex).trim();
    emojis.push({
      category: mapGroupToCategory(group),
      sub_category: formatSubCategory(subgroup),
      code: codePart.toLowerCase(),
      emoji: emojiChar,
      title: title.replace(/^e\d+(\.\d+)?[-\s]*/i, ''),
      aliases: [],
      shortcodes: { cldr: [], github: [], slack: [], discord: [] },
      tags: [],
      codepoints: [`U+${codePart.toUpperCase()}`],
      image: {}
    });
  }
  return emojis;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEmojiDetails(emojiObj, buildID) {
  try {
    const detailsUrl = `https://emojipedia.org/${titleToSlug(emojiObj.title)}/`;
    console.log(`Fetching details for "${emojiObj.title}" from ${detailsUrl}`);
    
    const detailsRes = await axios.get(detailsUrl);
    const detailsHtml = detailsRes.data;
    const $ = load(detailsHtml);
    
    const nextData = JSON.parse($('#__NEXT_DATA__').text());
    const emojiSlug = nextData.query.emoji;
    
    const emojiJsonUrl = `https://emojipedia.org/_next/data/${buildID}/en/${emojiSlug}.json`;
    console.log(`Fetching JSON details for "${emojiObj.title}" from ${emojiJsonUrl}`);
    const emojiJsonRes = await axios.get(emojiJsonUrl);
    
    // Try to extract emojiData from the expected property.
    let emojiData;
    try {
      emojiData = emojiJsonRes.data.pageProps.dehydratedState.queries[3].state.data;
    } catch (err) {
      emojiData = null;
    }
    
    // If emojiData is invalid, fallback to the GraphQL endpoint.
    if (!emojiData) {
      console.log(`Emoji data is invalid. Falling back to GraphQL query for "${emojiObj.title}"`);
      const graphqlPayload = {
        query: `query emojiV1($slug: Slug!, $lang: Language) {
  emoji_v1(slug: $slug, lang: $lang) {
    id
    title
    code
    slug
    currentCldrName
    codepointsHex
    description
    modifiers
    appleName
    alsoKnownAs
    shortcodes {
      code
      source
    }
    vendorsAndPlatforms {
      slug
      title
      items {
        title
        image {
          source
        }
      }
    }
  }
}`,
        variables: {
          slug: titleToSlug(emojiObj.title),
          lang: "EN"
        },
        operationName: "emojiV1"
      };

      const graphqlHeaders = {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9,id;q=0.8',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'origin': 'https://emojipedia.org',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': detailsUrl,
        'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'x-client': 'emojipedia.org',
        'x-query-hash': 'bd776365e1829219baf2002a1be10f332c05434d'
      };

      const graphqlRes = await axios.post('https://emojipedia.org/api/graphql', graphqlPayload, { headers: graphqlHeaders });
      emojiData = graphqlRes.data.data.emoji_v1;
    }
    
    // Update emojiObj with data from either source.
    emojiObj.aliases = emojiData.alsoKnownAs || [];
    if (emojiData.currentCldrName && emojiData.appleName && emojiData.currentCldrName !== emojiData.appleName) {
      emojiObj.aliases.push(emojiData.appleName);
    }
    emojiObj.shortcodes = emojiData.shortcodes?.reduce((acc, { code, source }) => {
      acc[source] = acc[source] || [];
      acc[source].push(code);
      return acc;
    }, {}) || {};

    const vendor = emojiData.vendorsAndPlatforms && emojiData.vendorsAndPlatforms[0];
    if (vendor && vendor.items && vendor.items.length > 0) {
      emojiObj.image = {
        brand: vendor.slug,
        platform: [vendor.items[0].title, vendor.title],
        source: vendor.items[0].image.source
      };
    }
    
    emojiObj.code = emojiData.codepointsHex.join("-").replace(/U\+/g, "").toLowerCase();
    emojiObj.emoji = emojiData.code;
  } catch (error) {
    console.warn(`Failed to fetch details for "${emojiObj.title}": ${error.message}`);
  }
  return emojiObj;
}

async function updateEmojiDatabase() {
  try {
    console.log('Fetching Unicode emoji data...');
    const emojiTestRes = await axios.get(EMOJI_TEST_URL);
    const emojiTestText = emojiTestRes.data;
    console.log('Parsing emoji data...');
    const emojis = parseEmojiTest(emojiTestText);
    console.log(`Parsed ${emojis.length} emojis. Fetching additional details from Emojipedia...`);
    
    const homepageUrl = 'https://emojipedia.org/';
    const homepageRes = await axios.get(homepageUrl);
    const homepageHtml = homepageRes.data;
    const $homepage = load(homepageHtml);
    const nextDataHomepage = JSON.parse($homepage('#__NEXT_DATA__').text());
    const buildID = nextDataHomepage.buildId;
    console.log(`Obtained buildID: ${buildID}`);
    
    // Create a writable stream to write each emoji result immediately.
    const stream = fs.createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });
    stream.write('[\n'); // start JSON array
    
    let isFirst = true;
    // Process emojis sequentially to limit memory usage.
    for (const emojiObj of emojis) {
      console.log('========================================');
      console.log(`Processing "${emojiObj.title}" (${emojiObj.emoji})...`);
      console.log('========================================');
      const detailedEmoji = await fetchEmojiDetails(emojiObj, buildID);
      
      // Write a comma if this isn't the first entry.
      if (!isFirst) {
        stream.write(',\n');
      } else {
        isFirst = false;
      }
      
      stream.write(JSON.stringify(detailedEmoji, null, 2));
      await delay(1000); // delay between requests
    }
    
    stream.write('\n]');
    stream.end();
    
    console.log(`Emoji database updated. Output written to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error('Error updating emoji database:', err);
    console.error(err.stack);
  }
}

updateEmojiDatabase();
