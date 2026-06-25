import dotenv from 'dotenv';
dotenv.config();
import { loadDailyPost, buildLinkedInBriefSection, buildLinkedInBriefHTML, buildLinkedInShareUrl } from '../src/services/linkedinShare.js';
import { sendMail } from '../src/services/mailer.js';

const post = loadDailyPost();
if (!post) { console.log('No post — run generateLinkedInPost.js first'); process.exit(0); }

const { shareUrl } = buildLinkedInShareUrl(post);

await sendMail({
  to: 'm.aliben432@gmail.com',
  subject: 'ClinicFlow Morning Brief — LinkedIn test',
  text: `Good morning Mohamed.\n\n${buildLinkedInBriefSection(post)}`,
  html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h3 style="color:#0f172a;margin-bottom:20px">Good morning, Mohamed.</h3>
    ${buildLinkedInBriefHTML(post)}
    <p style="font-size:12px;color:#94a3b8;margin-top:30px">
      After posting: <code>node src/cli/markLinkedInPosted.js</code>
    </p>
  </div>`,
});

console.log('✓ Test brief sent to m.aliben432@gmail.com');
console.log('Open it and click "Post to LinkedIn →"');
console.log('Tell me if LinkedIn opens with the text prefilled');
