const SLACK_MESSAGE_TS_PATTERN = /^\d+\.\d+$/;

export function isSlackMessageTs(value) {
  return typeof value === 'string' && SLACK_MESSAGE_TS_PATTERN.test(value);
}

export function resolvePanelThreadTs({ channelId, explicitThreadTs, panelInfo }) {
  if (isSlackMessageTs(explicitThreadTs)) {
    return explicitThreadTs;
  }

  if (panelInfo?.channel_id !== channelId) {
    return null;
  }

  return isSlackMessageTs(panelInfo.message_ts) ? panelInfo.message_ts : null;
}

export function buildThreadReplyMessage({ channelId, threadTs, text }) {
  if (typeof channelId !== 'string' || !channelId.trim()) {
    throw new Error('Slack channel ID is required.');
  }

  if (!isSlackMessageTs(threadTs)) {
    throw new Error('A valid Slack thread timestamp is required.');
  }

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Slack message text is required.');
  }

  return {
    channel: channelId,
    text,
    thread_ts: threadTs,
    reply_broadcast: false,
  };
}

export function shouldRecreateWorkPanel(slackErrorCode) {
  return slackErrorCode === 'message_not_found';
}
