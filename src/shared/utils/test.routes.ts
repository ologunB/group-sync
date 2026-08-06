import { Router, Request, Response } from 'express';
import { redis, prisma } from '../../database/connection';
import { ResponseHelper } from '../utils/response.helper';

// These routes are ONLY mounted in non-production environments.
// They expose internal state (Redis OTPs, DB writes) so the integration test
// suite can run without requiring direct Redis/Prisma imports on the test runner.

const router = Router();

// GET /test/otp?email=X&type=verify_email|forgot_password
router.get('/otp', async (req: Request, res: Response) => {
    const { email, type } = req.query as { email?: string; type?: string };
    if (!email) {
        ResponseHelper.error(res, 'email query param required', 400);
        return;
    }
    const prefix = type === 'forgot_password' ? 'verify:forgot' : 'verify:email';
    const key = `${prefix}:${email}`;
    const otp = await redis.get(key);
    if (!otp) {
        ResponseHelper.error(res, `OTP not found for ${email}`, 404);
        return;
    }
    ResponseHelper.success(res, { otp });
});

// GET /test/phone-otp/:userId
// Phone OTPs are keyed by user id rather than by number — the number itself is stored
// encrypted, so putting it in a Redis key would defeat that.
router.get('/phone-otp/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    const otp = await redis.get(`verify:phone:${userId}`);
    if (!otp) {
        ResponseHelper.error(res, `Phone OTP not found for ${userId}`, 404);
        return;
    }
    ResponseHelper.success(res, { otp });
});

// PATCH /test/verify-user/:userId
router.patch('/verify-user/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    await prisma.user.update({
        where: { id: userId },
        data:  { idVerificationStatus: 'verified' },
    });
    ResponseHelper.success(res, { userId });
});

// PATCH /test/verify-phone/:userId
// Shortcut past the SMS round-trip. The phone rung of the ladder is un-enforced by
// default (REQUIRE_PHONE_VERIFICATION=false), so this is only load-bearing for the
// tests that flip it on — the rest keep calling it so they still pass once it does.
router.patch('/verify-phone/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    await prisma.user.update({
        where: { id: userId },
        data:  { phoneVerifiedAt: new Date() },
    });
    ResponseHelper.success(res, { userId });
});

// PATCH /test/approve-group/:groupId
// Groups are created 'pending' and stay out of Explore until reviewed, so a test that
// asserts on discovery has to move them through the queue first.
router.patch('/approve-group/:groupId', async (req: Request, res: Response) => {
    const { groupId } = req.params;
    await prisma.group.update({
        where: { id: groupId },
        data:  { reviewStatus: 'approved', reviewedAt: new Date() },
    });
    ResponseHelper.success(res, { groupId });
});

// POST /test/reset-group-quota/:userId
// Group creation is capped at 3 per rolling 7 days, counted from groups.created_at.
// Back-dating a user's existing groups puts them outside the window, which resets the
// allowance without weakening the rule itself — the suite creates far more than 3.
router.post('/reset-group-quota/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const result = await prisma.group.updateMany({
        where: { createdBy: userId },
        data:  { createdAt: longAgo },
    });
    ResponseHelper.success(res, { userId, backdated: result.count });
});

// POST /test/clear-phone-otp-cooldown/:userId
// The 60-second resend lock is correct in production and pure friction in a test that
// exercises the send path twice.
router.post('/clear-phone-otp-cooldown/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    await redis.del(`verify:phone:cooldown:${userId}`);
    ResponseHelper.success(res, { userId });
});

// POST /test/seed-notification
router.post('/seed-notification', async (req: Request, res: Response) => {
    const { userId, type = 'system', title, body } = req.body as {
        userId: string; type?: string; title: string; body: string;
    };
    if (!userId || !title || !body) {
        ResponseHelper.error(res, 'userId, title, body are required', 400);
        return;
    }
    const notif = await prisma.notification.create({
        data: { userId, type, title, body },
    });
    ResponseHelper.success(res, { id: notif.id }, 'Notification seeded', 201);
});

// GET /test/presence/:userId
router.get('/presence/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    const value = await redis.get(`presence:${userId}`);
    ResponseHelper.success(res, { present: value !== null, value });
});

// POST /test/seed-feed
// Seeds 100 diverse posts (mix of text, link, public/private, pinned) into a group.
// Body: { groupId, authorId }
router.post('/seed-feed', async (req: Request, res: Response) => {
    const { groupId, authorId } = req.body as { groupId?: string; authorId?: string };
    if (!groupId || !authorId) {
        ResponseHelper.error(res, 'groupId and authorId are required', 400);
        return;
    }

    const topics = [
        { content: 'Welcome to our community! We\'re glad you\'re here. Introduce yourself below 👋', isPublic: true, isPinned: true },
        { content: 'Community Guidelines: Be respectful, stay on topic, and support each other. Together we build something great.', isPublic: true, isPinned: true },
        { content: 'Big announcement: we\'re hosting our first in-person meetup next month! Drop your city in the comments.', isPublic: true },
        { content: 'What\'s one skill you learned this year that changed how you work?', isPublic: false },
        { content: 'Just finished reading Atomic Habits. The 1% rule is genuinely life-changing. What book changed your mindset?', isPublic: true },
        { content: 'Hot take: remote work is better for deep work, office is better for collaboration. Change my mind.', isPublic: false },
        { content: 'Weekly check-in — what are you working on this week? Let\'s hold each other accountable.', isPublic: false },
        { content: 'Sharing a resource I found invaluable this month: a free course on systems thinking.', linkUrl: 'https://thesystemsthinker.com', isPublic: true },
        { content: 'Who here is in the tech industry? Would love to network and share opportunities.', isPublic: false },
        { content: 'Friday wins! Share your biggest professional win from this week. No humble brags — real brags only 🏆', isPublic: false },
        { content: 'Dropped a new article on building habits that actually stick. Would love your feedback.', linkUrl: 'https://medium.com', isPublic: true },
        { content: 'Anyone using AI tools in their day-to-day workflow? What\'s been the most useful one for you?', isPublic: true },
        { content: 'Networking tip: reply to 3 posts in this group every week. Visibility builds community.', isPublic: true },
        { content: 'Just got promoted! First time being someone\'s manager. Any advice for a first-time leader?', isPublic: false },
        { content: 'Monthly reading thread — what are you reading right now? Drop the title and a one-sentence review.', isPublic: false },
        { content: 'Reminder: the monthly group call is this Saturday at 3 PM WAT. Link in comments.', isPublic: false },
        { content: 'Sharing my portfolio for feedback. I redesigned it from scratch over the weekend.', linkUrl: 'https://dribbble.com', isPublic: true },
        { content: 'Does anyone have experience with fundraising for a social enterprise? Would love a quick chat.', isPublic: false },
        { content: 'Three things that helped me break out of creative block: long walks, talking to strangers, and reading fiction.', isPublic: true },
        { content: 'Question: how do you balance client work with personal projects without burning out?', isPublic: false },
        { content: 'If you could go back and give yourself one piece of career advice at 22, what would it be?', isPublic: false },
        { content: 'Recommended tool: Notion for content planning, Linear for dev teams, Fathom for calls. All game changers.', isPublic: true },
        { content: 'Thinking about launching a newsletter. Is Substack still the best platform in 2025?', isPublic: false },
        { content: 'The most underrated skill in any career: learning to ask better questions.', isPublic: true },
        { content: 'Just reached 500 newsletter subscribers. Starting from zero six months ago. Consistency is everything.', isPublic: true },
        { content: 'Monthly challenge: post one thing you\'re grateful for professionally this month. I\'ll start: a great mentor.', isPublic: false },
        { content: 'LinkedIn or X (Twitter)? Where do you find the most meaningful professional connections?', isPublic: false },
        { content: 'Career pivots — anyone here successfully transitioned industries? Would love to hear your story.', isPublic: false },
        { content: 'How do you handle imposter syndrome when you\'re the smartest person in the room? (yes, it still happens)', isPublic: false },
        { content: 'We hit 200 members! Thank you all for being part of this community. Growth update in comments 📈', isPublic: true },
        { content: 'Resource drop: 20 free design tools every solo founder should know.', linkUrl: 'https://www.producthunt.com', isPublic: true },
        { content: 'What does your ideal morning routine look like? I\'m rebuilding mine from scratch.', isPublic: false },
        { content: 'Accountability post: I said I\'d finish the course by end of month. Update: I did it! 🎉', isPublic: false },
        { content: 'Freelancers: how do you price your services when clients push back on rates?', isPublic: false },
        { content: 'Deep work tip: block your first 3 hours for the most cognitively demanding task. Everything else is noise.', isPublic: true },
        { content: 'Interesting article on the future of work and why skills matter more than degrees.', linkUrl: 'https://hbr.org', isPublic: true },
        { content: 'Anyone here bootstrapping a startup? Let\'s build in public together.', isPublic: false },
        { content: 'The 3 metrics I track to stay productive: tasks completed, hours in flow, energy level at end of day.', isPublic: true },
        { content: 'Vulnerability post: I failed a big client pitch last week. Here\'s what I learned from it.', isPublic: false },
        { content: 'What\'s the best investment you\'ve made in your professional development? Mine was a public speaking course.', isPublic: false },
        { content: 'Community poll: what time zones are most of you in? Planning to schedule future calls inclusively.', isPublic: false },
        { content: 'Excited to share: our first member just got published in a major trade journal. Proud of you!', isPublic: true },
        { content: 'Note-taking systems: Zettelkasten, PARA, or just vibes? What actually works for you?', isPublic: false },
        { content: 'The single most impactful thing I did for my career this year was saying no to bad-fit clients.', isPublic: true },
        { content: 'Cold email template that got me a 40% reply rate — sharing it because this community has given me so much.', isPublic: false },
        { content: 'Interesting take on why most productivity advice fails most people.', linkUrl: 'https://ness-labs.com', isPublic: true },
        { content: 'Is anyone else finding it harder to focus in 2025? The notification economy is brutal.', isPublic: false },
        { content: 'Recommended podcast: Indie Hackers. Every episode is a case study in grit and creativity.', isPublic: true },
        { content: 'Weekly thread: share one thing you\'re struggling with professionally. No judgment — just solidarity.', isPublic: false },
        { content: 'If you\'re a lurker, this is your sign to post something this week. We want to hear from you!', isPublic: false },
        { content: 'I published my first open-source library. It took 4 months of evenings. Worth every minute.', isPublic: true },
        { content: 'Learning in public: started my cybersecurity cert journey. Day 1 of 180. Follow along!', isPublic: false },
        { content: 'Anyone who\'s done a product launch solo: what was your biggest unexpected challenge?', isPublic: false },
        { content: 'Controversial opinion: meetings are not the problem. Bad facilitation is.', isPublic: true },
        { content: 'Career resource: free resume template optimised for ATS. Saved me hours.', linkUrl: 'https://rxresu.me', isPublic: true },
        { content: 'One year ago I was unemployed. Today I have three clients. If you\'re in a rough patch — it gets better.', isPublic: true },
        { content: 'Salary transparency: do you share your income with peers? Why or why not?', isPublic: false },
        { content: 'Book recommendation: "So Good They Can\'t Ignore You" by Cal Newport. Career-defining read.', isPublic: true },
        { content: 'I turned down a high-paying job to stay true to my values. Best decision I ever made (3 years later).', isPublic: false },
        { content: 'Free webinar reminder: tomorrow at 6 PM — "Building a Personal Brand Without the Cringe"', isPublic: false },
        { content: 'Community feedback: what topics do you want us to cover in our next workshop?', isPublic: false },
        { content: 'Sharing my content calendar template for anyone who struggles to stay consistent.', linkUrl: 'https://notion.so', isPublic: true },
        { content: 'The best mentor I ever had gave me one rule: always make your manager\'s job easier.', isPublic: true },
        { content: 'Asking for a raise is a skill. Here are 5 things I said that made it work.', isPublic: false },
        { content: 'Introvert-friendly networking tip: be the person who asks great questions. Works every time.', isPublic: true },
        { content: 'I read 52 books last year. Here are the 5 that actually changed my thinking.', isPublic: true },
        { content: 'Anyone building in Africa? Would love to connect with founders on the continent.', isPublic: false },
        { content: 'Resources for first-time managers: one book, one podcast, one framework that helped me most.', isPublic: false },
        { content: 'My design philosophy: remove anything that requires explanation.', isPublic: true },
        { content: 'Grateful post: this community helped me land my first international client last month. Thank you 🙏', isPublic: false },
        { content: 'What does "work-life balance" actually look like for you day to day? Not the theory — the practice.', isPublic: false },
        { content: 'I stopped tracking followers and started tracking impact. Completely changed how I create content.', isPublic: true },
        { content: 'Sharing the deck I used to pitch my startup. Took 47 revisions. Here\'s what made the difference.', linkUrl: 'https://pitch.com', isPublic: false },
        { content: 'To every person who\'s ever sent a cold DM that went nowhere: keep going. It only takes one yes.', isPublic: true },
        { content: 'Weekly writing prompt: write 3 sentences about the professional you want to be in 5 years.', isPublic: false },
        { content: 'The role of empathy in leadership is wildly underestimated. Building trust is the whole job.', isPublic: true },
        { content: 'Drop your portfolio, GitHub, or LinkedIn below. Let\'s support each other\'s work.', isPublic: false },
        { content: 'The hardest part of freelancing isn\'t the work — it\'s the feast-or-famine cycle. How do you smooth it out?', isPublic: false },
        { content: 'We\'re launching a mentorship program within this group. Applications open next week!', isPublic: true },
        { content: 'Why I stopped chasing "hustle culture" and what I do instead to stay productive.', isPublic: true },
        { content: 'If you could master one skill in the next 12 months, what would it be and why?', isPublic: false },
        { content: 'Sharing a system I built to manage client communication without losing my mind.', isPublic: false },
        { content: 'I took a 2-week digital detox. Here\'s what I noticed when I came back to the internet.', isPublic: true },
        { content: 'The best advice I received as a junior: read the room before speaking in meetings.', isPublic: false },
        { content: 'Anyone else feel like the best professional conversations happen in communities like this? 💙', isPublic: true },
        { content: 'Quote of the week: "Your network is your net worth — invest in it every day."', isPublic: true },
        { content: 'Done is better than perfect. Ship the thing. Iterate later. This mindset saved my first product.', isPublic: true },
        { content: 'What\'s your go-to framework for making tough career decisions? I use the 10-10-10 rule.', isPublic: false },
        { content: 'Three signs you\'re in the right community: you learn, you contribute, and you feel seen.', isPublic: true },
        { content: 'Tools I use daily: Obsidian for notes, Raycast for speed, Arc for browsing. What\'s in your stack?', isPublic: false },
        { content: 'I used to overthink every post. Now I ship and learn from reactions. Growth is in the reps.', isPublic: true },
        { content: 'Throwback to when I had zero idea what I was doing. Progress isn\'t linear — but it is real.', isPublic: false },
        { content: 'End of month reflection: what worked, what didn\'t, and one thing you\'ll carry into next month.', isPublic: false },
        { content: 'Final thought for the week: you belong here. Keep showing up. 🌱', isPublic: true },
    ];

    const now = new Date();
    const created = await prisma.groupPost.createMany({
        data: topics.map((t, i) => ({
            groupId,
            authorId,
            content:   t.content,
            linkUrl:   (t as any).linkUrl ?? null,
            mediaUrls: [],
            isPublic:  t.isPublic,
            isPinned:  t.isPinned ?? false,
            // Spread posts back over last 100 days for realistic timeline
            createdAt: new Date(now.getTime() - (100 - i) * 24 * 60 * 60 * 1000),
            updatedAt: new Date(now.getTime() - (100 - i) * 24 * 60 * 60 * 1000),
        })),
        skipDuplicates: true,
    });

    ResponseHelper.success(res, { count: created.count }, 'Feed seeded', 201);
});

export default router;
