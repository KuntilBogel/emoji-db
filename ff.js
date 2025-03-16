import { load } from 'cheerio';

const html = `
<tr class="Table_table-tr__QVFqS">
  <td class="someClass"><span>Shortcodes</span></td>
  <td class="anotherClass">
    <div>:beaming_face_with_smiling_eyes:&nbsp;(<a href="/shortcodes" class="Link_link-wrapper" target="_self">Emojipedia</a>)</div>
    <div>:grin:&nbsp;(<a href="/github" class="Link_link-wrapper" target="_self">GitHub</a>,&nbsp;<a href="/slack" class="Link_link-wrapper" target="_self">Slack</a>,&nbsp;<a href="/discord" class="Link_link-wrapper" target="_self">Discord</a>)</div>
  </td>
</tr>
`;

const $ = load(html);
console.log('v4 - Structure-independent version');

// Since the HTML structure is being altered during parsing,
// let's work directly with the divs that contain our shortcodes
const shortcodesData = {
  'cldr': [],
  'github': [],
  'slack': [],
  'discord': []
};

// Process all divs in the document
$('div').each(function () {
  // Extract the shortcode from the div's text using a regex
  const text = $(this).text().trim();
  console.log('Processing div text:', text);
  
  const shortcodeMatch = text.match(/(:[^:\s]+:)/);
  
  if (shortcodeMatch) {
    const shortcode = shortcodeMatch[1];
    console.log('Found shortcode:', shortcode);
    
    // Get all platform links in this div
    const links = $(this).find('a');
    console.log('Number of links:', links.length);
    
    links.each(function() {
      // Extract platform name from href or text
      const href = $(this).attr('href');
      const platformText = $(this).text().trim().toLowerCase();
      console.log('Link:', { href, platformText });
      
      // Determine which platform this is
      let platform;
      if (href === '/shortcodes' || platformText === 'emojipedia') {
        platform = 'cldr';
      } else if (href === '/github' || platformText === 'github') {
        platform = 'github';
      } else if (href === '/slack' || platformText === 'slack') {
        platform = 'slack';
      } else if (href === '/discord' || platformText === 'discord') {
        platform = 'discord';
      } else {
        console.log('Unknown platform, skipping');
        return; // Skip unknown platforms
      }
      
      console.log('Adding to platform:', platform);
      
      // Add the shortcode to the appropriate platform array if not already there
      if (!shortcodesData[platform].includes(shortcode)) {
        shortcodesData[platform].push(shortcode);
      }
    });
  }
});

console.log('Final shortcodesData:', shortcodesData);

// Create the final emoji object structure
const emojiObj = {
  shortcodes: {
    cldr: shortcodesData.cldr,
    github: shortcodesData.github,
    slack: shortcodesData.slack,
    discord: shortcodesData.discord
  }
};

console.log('Final output:');
console.log(JSON.stringify(emojiObj, null, 2));