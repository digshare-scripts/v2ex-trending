import {script} from '@digshare/script';

import * as Cheerio from 'cheerio';
import ms from 'ms';

const THRESHOLD_TOLERANCE = ms('5min');

const THRESHOLDS = [
  // {
  //   spanText: ' 5 分钟',
  //   span: ms('5min') + THRESHOLD_TOLERANCE,
  //   count: 2,
  // },
  // {
  //   spanText: ' 10 分钟',
  //   span: ms('10min') + THRESHOLD_TOLERANCE,
  //   count: 2,
  // },
  {
    spanText: ' 30 分钟',
    span: ms('30min') + THRESHOLD_TOLERANCE,
    count: 30,
  },
  {
    spanText: ' 1 小时',
    span: ms('1h') + THRESHOLD_TOLERANCE,
    count: 45,
  },
  {
    spanText: ' 2 小时',
    span: ms('2h') + THRESHOLD_TOLERANCE,
    count: 60,
  },
];

const HISTORY_LIMIT = 5; // 最长 2 小时，30 分钟执行一次，有 4 组记录，再加 1 组一共五组。
const PUSHED_LIMIT = 100;

interface State {
  history: Item[][];
  pushed: string[];
}

export default script<State>(async (state = {history: [], pushed: []}) => {
  const now = Date.now();

  const pushedSet = new Set(state.pushed);

  const html = await fetch('https://v2ex.com/?tab=all').then(response =>
    response.text(),
  );

  const $ = Cheerio.load(html);

  const items = $('#Main .box .item')
    .toArray()
    .map((item): Item | undefined => {
      const $item = $(item);

      const $titleA = $item.find('.item_title > a');

      const title = $titleA.text().trim();
      const href = $titleA.attr('href');

      const $topicInfo = $item.find('.topic_info');

      const node = $topicInfo.find('.node').text().trim();

      const author = $topicInfo.find('.node + strong > a').text().trim();

      const count = Number($item.find('.count_livid').text().trim() || '0');

      if (!title || !href || !node || !author) {
        return undefined;
      }

      const id = href.match(/^\/t\/(\d+)/)![1];

      return {
        id,
        title,
        href,
        node,
        author,
        count,
        timestamp: now,
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);

  if (items.length === 0) {
    throw new Error('没有获取到内容');
  }

  const history = state.history;

  const idToLatestItemMap = new Map(items.map(item => [item.id, item]));

  const hots: Hot[] = [];

  for (const historyItems of history) {
    for (const item of historyItems) {
      const latest = idToLatestItemMap.get(item.id);

      if (!latest) {
        continue;
      }

      if (pushedSet.has(item.id)) {
        continue;
      }

      const change = {
        span: latest.timestamp - item.timestamp,
        count: latest.count - item.count,
      };

      const thresholdMet = THRESHOLDS.find(
        threshold =>
          change.count >= threshold.count && change.span <= threshold.span,
      );

      if (!thresholdMet) {
        continue;
      }

      pushedSet.add(item.id);

      hots.push({
        item: latest,
        threshold: thresholdMet,
        change: change.count,
      });
    }
  }

  state.history = [...history, items].slice(-HISTORY_LIMIT);
  state.pushed = [...pushedSet].slice(-PUSHED_LIMIT);

  if (hots.length === 0) {
    console.info('没有发现新的热帖');
    return {
      state,
    };
  }

  return {
    message: {
      tags: hots.map(({item}) => item.node),
      content: `\
发现了 ${hots.length} 条正在上窜的帖子：

${hots
  .map(
    ({item, threshold, change}) => `\
- 【${item.node}】[${item.title}](https://v2ex.com${item.href})
  （💬${threshold.spanText}内新增了 ${change} 条评论）`,
  )
  .join('\n\n')}
`,
    },
    state,
  };
});

interface Threshold {
  spanText: string;
  span: number;
  count: number;
}

interface Item {
  id: string;
  title: string;
  href: string;
  node: string;
  author: string;
  count: number;
  timestamp: number;
}

interface Hot {
  item: Item;
  threshold: Threshold;
  change: number;
}
