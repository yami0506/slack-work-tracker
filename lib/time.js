const TOKYO_TIME_ZONE = 'Asia/Tokyo';

export function formatTokyoDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '日時不明';
  }

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TOKYO_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `${Number(parts.month)}/${Number(parts.day)} ${parts.hour}:${parts.minute}`;
}

export function calculateDurationMinutes(startedAt, endedAt) {
  const startedAtTime = new Date(startedAt).getTime();
  const endedAtTime = new Date(endedAt).getTime();

  if (Number.isNaN(startedAtTime) || Number.isNaN(endedAtTime)) {
    return 0;
  }

  const durationMs = Math.max(0, endedAtTime - startedAtTime);
  return Math.floor(durationMs / 1000 / 60);
}

export function formatDuration(minutes) {
  const totalMinutes = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}分`;
  }

  if (remainingMinutes === 0) {
    return `${hours}時間`;
  }

  return `${hours}時間${remainingMinutes}分`;
}
