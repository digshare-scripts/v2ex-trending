import {script} from '@digshare/script';

import fetch from 'node-fetch';
import * as Cheerio from 'cheerio';
import ms from 'ms';

const THRESHOLD_TOLERANCE = ms('1min');

const THRESHOLDS = [
  {
    spanText: ' 5 分钟',
    span: ms('5min') + THRESHOLD_TOLERANCE,
    count: 10,
  },
  {
    spanText: ' 10 分钟',
    span: ms('10min') + THRESHOLD_TOLERANCE,
    count: 15,
  },
  {
    spanText: ' 30 分钟',
    span: ms('30min') + THRESHOLD_TOLERANCE,
    count: 20,
  },
];

const HISTORY_LIMIT = 10;
const PUSHED_LIMIT = 1000;

interface Storage {
  history: Item[][];
  pushed: string[];
}

export default script<undefined, Storage>(async (_payload, {storage}) => {
  let now = Date.now();

  let pushedSet = new Set(storage.getItem('pushed'));

  let html = await fetch('https://v2ex.vilicvane.workers.dev/?tab=all').then(
    response => response.text(),
  );

  let $ = Cheerio.load(html);

  let items = $('#Main .box .item')
    .toArray()
    .map((item): Item | undefined => {
      let $item = $(item);

      let $titleA = $item.find('.item_title > a');

      let title = $titleA.text().trim();
      let href = $titleA.attr('href');

      let $topicInfo = $item.find('.topic_info');

      let node = $topicInfo.find('.node').text().trim();

      let author = $topicInfo.find('.node + strong > a').text().trim();

      let count = Number($item.find('.count_livid').text().trim() || '0');

      if (!title || !href || !node || !author) {
        return undefined;
      }

      let id = href.match(/^\/t\/(\d+)/)![1];

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
    console.error('没有获取到内容');
    return;
  }

  let history = storage.getItem('history') ?? [];

  let idToLatestItemMap = new Map(items.map(item => [item.id, item]));

  let messages: string[] = [];
  let links: {
    url: string;
    description: string;
  }[] = [];

  for (let historyItems of history) {
    for (let item of historyItems) {
      let latest = idToLatestItemMap.get(item.id);

      if (!latest) {
        continue;
      }

      if (pushedSet.has(item.id)) {
        continue;
      }

      let change = {
        span: latest.timestamp - item.timestamp,
        count: latest.count - item.count,
      };

      let thresholdMet = THRESHOLDS.find(
        threshold =>
          change.count >= threshold.count && change.span <= threshold.span,
      );

      if (!thresholdMet) {
        continue;
      }

      pushedSet.add(item.id);

      messages.push(`\
【${latest.node}】${latest.title}
（💬${thresholdMet.spanText}内新增了 ${change.count} 条评论）`);

      links.push({
        description: latest.title,
        url: `https://v2ex.com${latest.href}`,
      });
    }
  }

  storage.setItem('history', [...history, items].slice(-HISTORY_LIMIT));
  storage.setItem('pushed', [...pushedSet].slice(-PUSHED_LIMIT));

  if (messages.length === 0) {
    console.info('没有发现新的热帖');
    return undefined;
  }

  return {
    content: `\
发现了 ${messages.length} 条正在上窜的帖子：

${messages.join('\n\n')}
`,
    links,
  };
});

export interface Item {
  id: string;
  title: string;
  href: string;
  node: string;
  author: string;
  count: number;
  timestamp: number;
}
