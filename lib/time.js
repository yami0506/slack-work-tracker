const TOKYO_TIME_ZONE = 'Asia/Tokyo';
const TOKYO_UTC_OFFSET_HOURS = 9;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getTokyoDateParts(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

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

export function getTokyoDayRange(value = new Date()) {
  const parts = getTokyoDateParts(value);

  if (!parts) {
    return null;
  }

  const startTime = Date.UTC(parts.year, parts.month - 1, parts.day, -TOKYO_UTC_OFFSET_HOURS);
  const endTime = startTime + ONE_DAY_MS;

  return {
    start: new Date(startTime),
    end: new Date(endTime),
  };
}

export function getTokyoWeekRange(value = new Date()) {
  const parts = getTokyoDateParts(value);

  if (!parts) {
    return null;
  }

  const dayOfWeek = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const startTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day - daysSinceMonday,
    -TOKYO_UTC_OFFSET_HOURS,
  );
  const endTime = startTime + ONE_DAY_MS * 7;

  return {
    start: new Date(startTime),
    end: new Date(endTime),
  };
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
