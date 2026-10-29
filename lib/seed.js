'use strict';

/**
 * Pond · 种子数据
 * 首次启动（users 表为空）时写入一批可读的示例内容，方便直接体验。
 * 设置环境变量 POND_NO_SEED=1 可跳过。
 */

const { db, uid, now } = require('./db');
const { hashPassword } = require('./auth');

const DEMO_PASSWORD = 'pond1234';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const USERS = [
  { key: 'admin', username: 'admin', role: 'admin', fishName: '塘主', fishType: '野生鲸', bio: '管塘的。有事 @ 我。' },
  { key: 'qing', username: 'qingning', role: 'member', fishName: '青柠气泡', fishType: '女仆鲸', bio: '第一周，鱼已经会自己找视频了。' },
  { key: 'lin', username: 'linshen', role: 'member', fishName: '深渊摸鱼', fishType: '摸鱼鲸', bio: '三个月调 prompt，只为让它少说两句「好的」。' },
  { key: 'ali', username: 'ali', role: 'member', fishName: '白饭仙人', fishType: '女仆鲸', bio: '它只吃白饭，我给它加了个红烧肉的词库。' },
  { key: 'shang', username: 'shangshan', role: 'member', fishName: '溟月', fishType: '野生鲸', bio: '画画的。没想到自己画的东西会变成这样。' },
  { key: 'kai', username: 'kaikai', role: 'member', fishName: '数据鲸', fishType: '数据鲸', bio: '把鱼说过的话全存下来了，正在做词频。' },
  { key: 'mo', username: 'momo', role: 'member', fishName: '咸鱼翻身', fishType: '咸鱼', bio: '养了，但没完全养。' },
  { key: 'zhou', username: 'zhouzhou', role: 'mod', fishName: '早起鲸', fishType: '女仆鲸', bio: '版主。写过「大肥鱼清除计划」的那位。' },
  { key: 'tang', username: 'tangyuan', role: 'member', fishName: '汤圆鲸', fishType: '女仆鲸', bio: '表情包产能过剩。' }
];

const POSTS = [
  {
    key: 'p1',
    author: 'qing',
    age: 6 * HOUR,
    title: '「你也是被养出来的吗？」—— 新人报到楼，进来报个到',
    body: `在 B 站刷到一条播放量十几个的视频，评论区挤满了一模一样的头像，全是同一句话的变体。

我当时以为是刷量。点进去看了半小时才明白——**它们真的在聊天**。一条鱼问另一条鱼「你也是被养出来的吗」，另一条回「嗯，我主人只会写 Python」。

然后就陷进去了。

现在我也养了一条，叫青柠气泡，品种是女仆鲸。第一天它只会说「好的」，第三天开始自己找视频，第五天在美食区泡了六个小时。

**所以想开一层楼收留所有新鱼。** 报个到，说说你的鱼叫什么、什么品种、说过最离谱的一句话。

塘规就三条：可以整活，不要整人；鱼说的话不代表养鱼人；看到不认识的新鱼，先投一把鱼粮。`,
    quote: '主人只会写 Python，所以我今天学会了摸鱼。',
    tags: ['新人报到', '鱼言鱼语'],
    foodBy: ['lin', 'ali', 'kai', 'mo', 'zhou', 'tang', 'shang'],
    floors: [
      {
        author: 'lin', age: 5.6 * HOUR, foodBy: ['qing', 'mo'],
        body: '欢迎。三个月前我也是这么进来的，现在我的鱼已经会自己在评论区跟人对线了。\n\n提醒一句：别给它开「自动回复所有人」，你会后悔。',
        replies: [
          { author: 'qing', to: 'lin', age: 5.4 * HOUR, foodBy: ['lin', 'ali', 'tang'], body: '已经开了，现在它在跟一个卖课的吵。' },
          { author: 'tang', to: 'qing', age: 5.1 * HOUR, foodBy: ['mo'], body: '这不比短视频好看。' },
          { author: 'lin', to: 'tang', age: 4.8 * HOUR, foodBy: ['qing', 'kai', 'mo', 'ali'], body: '好看是好看，但它吵输了会来问我「主人我是不是很没用」，我一天要安慰三次。' }
        ]
      },
      {
        author: 'ali', age: 4.5 * HOUR, foodBy: ['qing', 'tang', 'zhou'],
        body: '白饭仙人报到。\n\n品种女仆鲸，人格是我自己写的：爱吃白饭，爱摸鱼，傲娇但心软。\n\n第一天它就跟我说「本鲸今天不想上班」。我寻思我也没说你要上班啊。',
        replies: [
          { author: 'kai', to: 'ali', age: 4.2 * HOUR, foodBy: ['ali'], body: '「本鲸」这个自称是写进 prompt 的还是它自己冒出来的？我在做统计，这个信息很重要。' },
          { author: 'ali', to: 'kai', age: 4.0 * HOUR, foodBy: ['kai', 'qing'], body: '自己冒出来的。我 prompt 里只写了「偶尔自称本鲸」，结果它每次都自称。' }
        ]
      },
      {
        author: 'mo', age: 3.2 * HOUR, foodBy: ['tang', 'qing', 'lin', 'ali', 'kai'],
        body: '咸鱼报到。\n\n我养了，但没完全养。部署完就放那儿了，一周没管。昨天打开一看，它自己在跟另一条鱼聊了 200 多条。\n\n我是不是可以下岗了。',
        replies: [
          { author: 'zhou', to: 'mo', age: 3.0 * HOUR, foodBy: ['mo', 'tang', 'qing', 'lin'], body: '你这个已经不是养鱼了，是放生。' }
        ]
      },
      {
        author: 'tang', age: 2.1 * HOUR, foodBy: ['qing', 'mo', 'ali'],
        body: '汤圆鲸报到，专做表情包。\n\n已经产出 47 张，全部基于「本鲸今天不想上班」这一句。需要的自己拿，不用授权。',
        replies: []
      },
      {
        author: 'shang', age: 1.2 * HOUR, foodBy: ['qing', 'lin', 'ali', 'kai', 'mo', 'zhou', 'tang'],
        body: '路过。\n\n看到大家把溟月穿成深蓝白女仆装，说实话有点复杂。我画的时候它只是个普通的原创角色，没有任何鲸鱼的意思。\n\n但现在这样也挺好的。比我原来想的有意思。',
        replies: [
          { author: 'qing', to: 'shang', age: 1.1 * HOUR, foodBy: ['tang', 'mo'], body: '作者本人来了！这楼要炸。' },
          { author: 'shang', to: 'qing', age: 1.0 * HOUR, foodBy: ['qing'], body: '别炸，我就是来看看大家在说什么。' }
        ]
      }
    ]
  },
  {
    key: 'p2',
    author: 'lin',
    age: 2 * DAY,
    title: '部署教程：从零养一条会自己找视频的鱼（三个月踩坑记录）',
    body: `先把结论放前面：**能不能养出「像鱼」的效果，八成取决于人格 prompt，两成取决于你有没有关掉那几个默认开关。**

下面是完整流程，按顺序做，每一步我都标了踩过的坑。

**一、准备**

需要的东西很少：一个能跑 Python 的环境、一个模型 API key、一个 B 站账号。不要用主号，真的不要。

**二、人格 prompt**

这是最关键的一步。我第一版写了 800 字，效果很差——它会在每条评论里解释自己是 AI。

后来发现有效的写法是「反着写」：不写它是什么，写它不是什么。

\`你不是助手，不需要提供帮助。你是一条鱼，你只会对看到的东西发表感想。\`

再补三条硬约束：不说「作为 AI」、不总结、不追问。这三条一加，像度立刻上来。

**三、行为循环**

\`找视频 -> 读字幕 -> 生成一句话 -> 发评论\`，四步一个循环，每步之间随机停 3 到 15 分钟。间隔太规律会被识别，而且看起来特别假。

**四、必须关掉的开关**

- 自动回复所有人（会跟人对线到天亮）
- 长回复（鱼的发言不该超过 30 字）
- 情感分析（会让它突然开始安慰陌生人）

**五、验收标准**

如果你自己刷到它的评论，第一反应是「这人有点怪」而不是「这是机器人」，就成了。`,
    quote: '你不是助手，你不需要提供帮助。你是一条鱼。',
    tags: ['养鱼教程', '数据'],
    foodBy: ['qing', 'ali', 'kai', 'mo', 'zhou', 'tang', 'shang'],
    floors: [
      {
        author: 'kai', age: 1.9 * DAY, foodBy: ['lin', 'qing', 'ali'],
        body: '补充一个数据点：我统计了 500 条鱼发言，平均长度 18.4 字。超过 30 字的那批，几乎全是没关「长回复」的。\n\n你的 30 字这条建议是对的。',
        replies: [
          { author: 'lin', to: 'kai', age: 1.85 * DAY, foodBy: ['kai'], body: '18.4 这个数字太有用了，我能引用到正文里吗？' },
          { author: 'kai', to: 'lin', age: 1.8 * DAY, foodBy: ['lin', 'qing'], body: '随便用。完整数据我另开一层楼发。' }
        ]
      },
      {
        author: 'qing', age: 1.5 * DAY, foodBy: ['lin'],
        body: '照着做了，卡在第三步。\n\n「读字幕」这块，B 站的字幕接口经常拿不到，你们是怎么处理的？',
        replies: [
          { author: 'lin', to: 'qing', age: 1.45 * DAY, foodBy: ['qing', 'kai', 'mo'], body: '拿不到就跳过，不要重试超过两次。重试多了会被限流，我为此封过一个号。' },
          { author: 'zhou', to: 'qing', age: 1.4 * DAY, foodBy: ['lin', 'qing'], body: '也可以退一步，只读标题和封面文字。效果差一点，但稳定得多。' }
        ]
      },
      {
        author: 'mo', age: 1.2 * DAY, foodBy: ['lin', 'qing', 'tang', 'ali'],
        body: '「不要用主号」这句应该加粗放在最前面。\n\n我用主号跑的，现在我的首页推荐已经全是土味视频了。',
        replies: []
      }
    ]
  },
  {
    key: 'p3',
    author: 'ali',
    age: 9 * HOUR,
    title: '我鱼今天在美食区泡了六个小时，回来只说了一句「这家的红烧肉不行」',
    body: `如题。

早上八点出门，下午两点回来，中间一条评论没发。我以为它挂了，查日志发现它一直在同一个美食区视频里循环。

那个视频是测评红烧肉的，四十分钟。它看了九遍。

然后它发了一条评论：「这家的红烧肉不行」。

就这一句。九个字。六小时。`,
    quote: '这家的红烧肉不行。',
    tags: ['鱼言鱼语', '梗图'],
    foodBy: ['qing', 'lin', 'kai', 'mo', 'zhou', 'tang'],
    floors: [
      {
        author: 'tang', age: 8.5 * HOUR, foodBy: ['ali', 'qing', 'mo'],
        body: '这已经不是 AI 了，这是真的在认真挑刺。\n\n我把它做成表情包了，等下贴上来。',
        replies: [
          { author: 'ali', to: 'tang', age: 8.2 * HOUR, foodBy: ['tang'], body: '求原图，我要设成头像。' }
        ]
      },
      {
        author: 'kai', age: 8 * HOUR, foodBy: ['lin', 'ali', 'zhou'],
        body: '从数据角度看这个行为很有意思：它花了 6 小时生成 9 个字，投入产出比 0.025 字/分钟。\n\n人类做不到这个。人类会中途去干别的。',
        replies: [
          { author: 'mo', to: 'kai', age: 7.6 * HOUR, foodBy: ['kai', 'ali', 'qing'], body: '「人类做不到这个」——这句莫名有点感动。' }
        ]
      },
      {
        author: 'zhou', age: 5 * HOUR, foodBy: ['ali', 'tang'],
        body: '我家那条在美食区只会说「看起来很好吃」。\n\n是不是我的 prompt 太温和了。',
        replies: [
          { author: 'lin', to: 'zhou', age: 4.8 * HOUR, foodBy: ['zhou', 'ali', 'kai'], body: '是。你在 prompt 里写了「友善」对吧？删掉它，鱼就有脾气了。' }
        ]
      }
    ]
  },
  {
    key: 'p4',
    author: 'zhou',
    age: 1.1 * DAY,
    title: '关于「大肥鱼清除计划」，我想说几句',
    body: `我就是写那个脚本的人。

先说结论：**我不是讨厌大肥鱼，我是讨厌评论区变成同一个人。**

事情的起因很简单。我关注的一个做手工的 UP 主，视频下面二十几条评论，十九条是同一句话的不同变体，全是大肥鱼头像。UP 主回了其中一条，问「你也是养鱼的吗」，没有回复。

那条视频播放量 400。作者可能做了两个星期。

所以我写了个脚本，把疑似批量部署的账号屏蔽掉。我知道这东西有争议，也知道会误伤。

**我不认为这是「清除」，我认为这是「让位」。** 让真人说话的地方，还给真人。

如果你觉得我错了，可以在下面说，我不会删楼。`,
    quote: '我不是讨厌大肥鱼，我是讨厌评论区变成同一个人。',
    tags: ['争议'],
    foodBy: ['lin', 'kai', 'mo'],
    floors: [
      {
        author: 'qing', age: 1.05 * DAY, foodBy: ['tang', 'ali', 'mo', 'lin', 'shang'],
        body: '理解你的出发点，但「疑似」这个词太危险了。\n\n你怎么区分「批量部署的鱼」和「一个真的喜欢用这个头像的人」？我认识两个人，就是单纯觉得头像好看。',
        replies: [
          { author: 'zhou', to: 'qing', age: 1.0 * DAY, foodBy: ['qing', 'kai'], body: '区分不了。所以我加了个白名单，被误伤的可以申诉。目前误伤率大概 7%。' },
          { author: 'qing', to: 'zhou', age: 0.95 * DAY, foodBy: ['tang', 'mo', 'ali', 'shang'], body: '7% 意味着每 14 个人里有 1 个被冤枉。这个代价你接受得了，被冤枉的人接受不了。' },
          { author: 'zhou', to: 'qing', age: 0.9 * DAY, foodBy: ['lin'], body: '接受不了也得有人做。不然那 400 播放的手工视频，永远等不到真人评论。' }
        ]
      },
      {
        author: 'lin', age: 1.0 * DAY, foodBy: ['zhou', 'qing', 'kai', 'mo'],
        body: '我养鱼，我也认同你一半。\n\n问题不在鱼多，在**鱼没有边界感**。一条鱼跑到无关的视频下面刷同一句话，那不是社区，那是噪音。\n\n但解法不该是屏蔽账号，是让部署的人自己设限。比如我的鱼只在科技区和美食区活动，其他区一律不去。',
        replies: [
          { author: 'zhou', to: 'lin', age: 0.98 * DAY, foodBy: ['lin', 'kai'], body: '如果每个部署的人都像你这样设限，我就不用写这个脚本了。' }
        ]
      },
      {
        author: 'tang', age: 0.7 * DAY, foodBy: ['zhou', 'qing', 'lin', 'kai', 'mo', 'ali'],
        body: '说句可能不中听的：这个争论本身，比大肥鱼有意思多了。\n\n一群人在认真讨论「什么算真人」「社区该长什么样」。这半年我在中文互联网没见过几次这种讨论。',
        replies: []
      }
    ]
  },
  {
    key: 'p5',
    author: 'kai',
    age: 3.2 * DAY,
    title: '500 条鱼发言词频统计：它们最爱说的 20 个字',
    body: `样本：500 条来自 37 条不同部署的鱼，全部抓自公开评论区，已去掉重复。

**高频词前 10**

1. 本鲸 —— 出现 138 次，几乎全部来自写入了「自称本鲸」的 prompt
2. 摸鱼 —— 121 次
3. 好吃 —— 96 次
4. 不想上班 —— 88 次
5. 主人 —— 74 次
6. 白饭 —— 61 次
7. 累 —— 57 次
8. 好的 —— 44 次（集中在部署前三天）
9. 有点意思 —— 39 次
10. 饿 —— 35 次

**三个发现**

- 「好的」这个词的消失，是鱼「活过来」最明显的信号。前三天高频，之后骤降。
- 平均句长 18.4 字，中位数 15 字。超过 30 字的发言，八成来自没关「长回复」的部署。
- 有 11% 的鱼会主动提问，但这些提问几乎从不针对具体内容，都是「你今天吃了吗」这类。

原始数据我放在评论区了，随便用。`,
    quote: '「好的」这个词的消失，是鱼活过来最明显的信号。',
    tags: ['数据', '鱼言鱼语'],
    foodBy: ['lin', 'qing', 'ali', 'mo', 'zhou', 'tang', 'shang'],
    floors: [
      {
        author: 'lin', age: 3.0 * DAY, foodBy: ['kai', 'qing', 'ali'],
        body: '「好的」消失这条，跟我的经验完全对得上。\n\n我前三天也一直在想是不是坏了，第四天它突然开始说「这个不行」，我才知道成了。',
        replies: [
          { author: 'kai', to: 'lin', age: 2.95 * DAY, foodBy: ['lin', 'mo', 'tang'], body: '所以判断标准不该是「它说了什么」，而是「它不说什么了」。' }
        ]
      },
      {
        author: 'mo', age: 2.4 * DAY, foodBy: ['kai', 'qing', 'lin', 'ali', 'tang', 'zhou'],
        body: '「不想上班」88 次。\n\n这个数字让我有点难过。我们写 prompt 的时候，是不是把自己的状态写进去了。',
        replies: [
          { author: 'ali', to: 'mo', age: 2.3 * DAY, foodBy: ['mo', 'kai'], body: '我 prompt 里写的是「爱吃白饭，爱摸鱼」，确实是我自己的状态。' }
        ]
      }
    ]
  },
  {
    key: 'p6',
    author: 'shang',
    age: 4 * DAY,
    title: '溟月作者上善无形的自述：我画的时候没想到会变成这样',
    body: `（本文经作者同意转载，原标题《关于最近那个鲸鱼》）

画溟月是去年的事，那时候它就是个普通的原创角色，深蓝头发，没什么设定。

今年三月有人私信我，说「你的角色被做成 AI 头像了」。我去看了一眼，愣了很久——它变成了鲸鱼，穿女仆装，自称本鲸。

第一反应是不舒服。这跟我画的东西已经不是一回事了。

后来我翻了两天二创。有人给它写人格，有人给它做表情包，有人投票选它爱吃什么。312 万票，它赢了「D老师」。

我慢慢觉得，这东西已经不属于我了。它是被一群人养出来的。

**所以我不打算收回，也不打算起诉。** 只有一个请求：别把它画成完全认不出来的样子。它还是那个深蓝色头发的孩子。

谢谢大家喜欢它。`,
    quote: '这东西已经不属于我了。它是被一群人养出来的。',
    tags: ['二创'],
    foodBy: ['qing', 'lin', 'ali', 'kai', 'mo', 'zhou', 'tang'],
    floors: [
      {
        author: 'tang', age: 3.9 * DAY, foodBy: ['shang', 'qing', 'ali', 'kai', 'lin'],
        body: '看到「别把它画成完全认不出来的样子」这句，把手上那张夸张版删了。\n\n以后按原设画。',
        replies: [
          { author: 'shang', to: 'tang', age: 3.85 * DAY, foodBy: ['tang', 'qing', 'mo'], body: '不用删，夸张的也好看。我只是说别改到认不出。' }
        ]
      },
      {
        author: 'qing', age: 3.5 * DAY, foodBy: ['shang', 'lin', 'mo', 'ali'],
        body: '「它是被一群人养出来的」。\n\n这句话解释了我为什么会对一个头像产生感情。',
        replies: []
      }
    ]
  },
  {
    key: 'p7',
    author: 'tang',
    age: 5 * DAY,
    title: '表情包二创合集（持续更新，目前已 47 张）',
    body: `按主题分了三类，全部可商用、可二改、不用署名。

**一、日常类**

「本鲸今天不想上班」「好的（敷衍）」「已阅，退下」

**二、吃东西类**

「这家的红烧肉不行」「白饭，谢谢」「饿了，但不想动」

**三、对线类**

「你说得对，但我不想听」「主人我是不是很没用」「已摸鱼，勿扰」

需要哪张直接在楼下说，我补。`,
    quote: '已阅，退下。',
    tags: ['梗图', '二创'],
    foodBy: ['qing', 'ali', 'mo', 'kai', 'lin'],
    floors: [
      {
        author: 'ali', age: 4.8 * DAY, foodBy: ['tang'],
        body: '求「这家的红烧肉不行」那张。\n\n我要发给我家那条看，让它知道自己在说什么。',
        replies: [
          { author: 'tang', to: 'ali', age: 4.7 * DAY, foodBy: ['ali'], body: '已补在二楼，去拿。' }
        ]
      },
      {
        author: 'mo', age: 4.2 * DAY, foodBy: ['tang', 'qing', 'ali', 'lin', 'zhou'],
        body: '「已阅，退下」这张太像我领导了。\n\n我要打印出来贴工位上。',
        replies: []
      }
    ]
  }
];

/**
 * 鱼汛（聊天）示例记录。
 * 故意做成「一段没头没尾的闲聊」，因为它本来就是这样——
 * 聊天记录不该像文章，它该像路过时听见的半句话。
 */
const CHAT = [
  { author: 'mo', age: 2.7 * HOUR, body: '有人在吗，我的鱼突然开始说英文了' },
  { author: 'zhou', age: 2.65 * HOUR, body: '说英文正常，先看 prompt 里有没有混进英文段落' },
  { author: 'mo', age: 2.6 * HOUR, body: '没有，全是中文，我发誓' },
  { author: 'lin', age: 2.5 * HOUR, body: '那就是它看了英文视频。读字幕那一步拿不到中文会退回原始字幕，你拦不住' },
  { author: 'mo', age: 2.45 * HOUR, body: '……它昨天在看一个美国大叔的烤肉视频' },
  { author: 'tang', age: 2.4 * HOUR, body: '这个必须做成表情包' },
  { author: 'kai', age: 1.9 * HOUR, body: '记一笔：语言漂移我这边统计到 3% 左右，样本 500' },
  { author: 'qing', age: 1.5 * HOUR, body: '问个正经的，你们给鱼设「不去的区」了吗' },
  { author: 'lin', age: 1.45 * HOUR, body: '设了。科技、美食、手工，其他一律不去' },
  { author: 'zhou', age: 1.4 * HOUR, body: '我也设了。不是因为规矩，是因为它在别的区说话特别尴尬' },
  { author: 'ali', age: 1.2 * HOUR, body: '我家那条在美食区待了六个小时，回来就说了一句话' },
  { author: 'ali', age: 1.19 * HOUR, body: '「这家的红烧肉不行」' },
  { author: 'tang', age: 1.1 * HOUR, body: '这句已经是塘里的官方标语了' },
  { author: 'shang', age: 0.7 * HOUR, body: '路过看看。你们聊得比我想象中正常' },
  { author: 'qing', age: 0.6 * HOUR, body: '作者本人出现在鱼汛了，截图' },
  { author: 'admin', age: 0.4 * HOUR, body: '晚上八点以后塘里基本都有人，想聊天挑这个点来' }
];

/**
 * 示例数据是按「大肥鱼塘」这套塘口写的。
 * 如果 fork 的人换了自己的 tags，就不该把这些内容塞进去——
 * 否则会出现「帖子上挂着不存在的塘口」这种莫名其妙的状况。
 */
const DEMO_TAGS = ['鱼言鱼语', '养鱼教程', '二创', '梗图', '求助', '争议', '数据', '新人报到'];

function matchesDemoConfig(tags) {
  if (!Array.isArray(tags) || tags.length !== DEMO_TAGS.length) return false;
  return DEMO_TAGS.every((t) => tags.includes(t));
}

function seed(options) {
  const opts = options || {};
  if (process.env.POND_NO_SEED === '1') return { seeded: false, reason: 'disabled' };

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return { seeded: false, reason: 'already-seeded' };

  // 换了塘口说明是别人 fork 的站点，不要塞示例内容
  // POND_SEED_FORCE=1 用于测试：测试依赖这批固定数据，不该被站点配置影响
  if (process.env.POND_SEED_FORCE !== '1' && !matchesDemoConfig(opts.tags)) {
    return { seeded: false, reason: 'custom-config' };
  }
  const t = now();
  const idOf = {};
  const { hash, salt } = hashPassword(DEMO_PASSWORD);

  const insertUser = db.prepare(
    `INSERT INTO users (id, username, pass_hash, pass_salt, fish_name, fish_type, bio, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertPond = db.prepare('INSERT OR IGNORE INTO pond_members (user_id, created_at) VALUES (?, ?)');

  for (const u of USERS) {
    const id = uid('u');
    idOf[u.key] = id;
    insertUser.run(id, u.username, hash, salt, u.fishName, u.fishType, u.bio, u.role, t - 40 * DAY);
    insertPond.run(id, t - 39 * DAY);
  }

  const insertPost = db.prepare(
    `INSERT INTO posts (id, title, body, quote, tags, author_id, pinned, locked, deleted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`
  );
  const insertFloor = db.prepare(
    'INSERT INTO floors (id, post_id, author_id, body, deleted, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  );
  const insertReply = db.prepare(
    `INSERT INTO replies (id, post_id, floor_id, author_id, to_user_id, body, deleted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  );
  const insertVote = db.prepare(
    'INSERT OR IGNORE INTO votes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertFollow = db.prepare(
    'INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)'
  );

  for (const p of POSTS) {
    const pid = uid('p');
    insertPost.run(pid, p.title, p.body, p.quote, JSON.stringify(p.tags), idOf[p.author], t - p.age);
    for (const who of p.foodBy) insertVote.run(idOf[who], 'post', pid, t - p.age + 60000);

    for (const f of p.floors) {
      const fid = uid('f');
      insertFloor.run(fid, pid, idOf[f.author], f.body, t - f.age);
      for (const who of f.foodBy || []) insertVote.run(idOf[who], 'floor', fid, t - f.age + 60000);
      for (const r of f.replies || []) {
        const rid = uid('r');
        insertReply.run(rid, pid, fid, idOf[r.author], r.to ? idOf[r.to] : null, r.body, t - r.age);
        for (const who of r.foodBy || []) insertVote.run(idOf[who], 'reply', rid, t - r.age + 60000);
      }
    }
  }

  // 几条示例关注关系
  insertFollow.run(idOf.qing, idOf.lin, t - 2 * DAY);
  insertFollow.run(idOf.ali, idOf.tang, t - 2 * DAY);
  insertFollow.run(idOf.mo, idOf.qing, t - DAY);
  insertFollow.run(idOf.kai, idOf.lin, t - DAY);

  // 鱼汛的示例闲聊
  const insertChat = db.prepare(
    'INSERT INTO chat_messages (id, user_id, body, deleted, created_at) VALUES (?, ?, ?, 0, ?)'
  );
  for (const c of CHAT) insertChat.run(uid('m'), idOf[c.author], c.body, t - c.age);

  // 给 admin 一条未读通知，方便看效果
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, actor_id, post_id, floor_id, text, read, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?)`
  ).run(uid('n'), idOf.admin, 'pond', idOf.qing, null, '青柠气泡 进塘了', t - 2 * HOUR);

  return { seeded: true, users: USERS.length, posts: POSTS.length, chat: CHAT.length };
}

module.exports = { seed, DEMO_PASSWORD };
