// Define SVG paths to avoid repetition
const PATH_ADD = `<path clip-rule="evenodd" fill="currentColor" fill-rule="evenodd" d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 110 18.001A9 9 0 0112 3Zm0 3a1 1 0 00-1 1v5.565l.485.292 3.33 2a1 1 0 001.03-1.714L13 11.435V7a1 1 0 00-1-1Z"/>`;
const PATH_REMOVE = `<path fill="currentColor" d="M19.793 5.793 8.5 17.086l-4.293-4.293a1 1 0 10-1.414 1.414L8.5 19.914 21.207 7.207a1 1 0 10-1.414-1.414Z"/>`;

function injectWatchLaterButtons() {
  document.querySelectorAll('ytd-rich-item-renderer').forEach(item => {
    const videoId = extractVideoId(item.querySelector('a.shortsLockupViewModelHostEndpoint')?.href);
    if (!videoId) return;

    // Each concern is guarded independently so metadata that renders late still gets picked up
    injectWatchLaterButton(item, videoId);
    injectPublishDate(item, videoId);
  });
}

// Add the native-looking Watch Later button to a single short
function injectWatchLaterButton(item, videoId) {
  // Prevent re-injecting into elements that already have the button
  if (item.querySelector('.custom-watch-later-container')) return;

  // Create the container and button elements
  const container = document.createElement('div');
  container.className = 'custom-watch-later-container';
  container.innerHTML = `
    <button class="custom-watch-later-button" title="Watch later" data-video-id="${videoId}">
      <svg viewBox="-2 -2 28 28">${PATH_ADD}</svg>
    </button>`;

  const button = container.querySelector('button');
  const icon = container.querySelector('svg');

  // Attach to the thumbnail parent container
  const thumb = item.querySelector('.shortsLockupViewModelHostThumbnailParentContainer');
  if (thumb) {
    thumb.style.position = 'relative';
    thumb.appendChild(container);
  }

  // Handle button toggle and API interaction
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const added = button.classList.toggle('added');

    // Update icon using the pre-defined constants
    icon.innerHTML = added ? PATH_REMOVE : PATH_ADD;

    executeYouTubeCommand(added ? 'add-to-watch-later' : 'remove-from-watch-later', videoId);
  });
}

// Extract the 11-character video ID from the URL string
function extractVideoId(url) {
  return url?.match(/(?:v=|\/shorts\/|\/watch\?v=)([a-zA-Z0-9_-]{11})/)?.[1] || null;
}

// Cache of in-flight and resolved publish-date lookups keyed by video ID
const dateCache = new Map();

// Show how long ago a short was published beside its view count since the grid omits it
function injectPublishDate(item, videoId) {
  const subhead = findSubhead(item);
  if (!subhead) return;

  // Marker prevents duplicate injection while allowing re-add if YouTube re-renders the subhead
  if (subhead.querySelector('.custom-shorts-date')) return;

  const span = document.createElement('span');
  span.className = 'custom-shorts-date';
  subhead.appendChild(span);

  fetchPublishDate(videoId).then(date => {
    if (!date) return span.remove();
    span.textContent = ` • ${formatTimeAgo(date)}`;
  });
}

// Locate the metadata line that holds the view count text
function findSubhead(item) {
  const el = item.querySelector('.shortsLockupViewModelHostMetadataSubhead');
  if (el) return el;

  // Fallback in case YouTube renames the class
  return [...item.querySelectorAll('span, div')].find(e => e.children.length === 0 && /\bviews?\b/i.test(e.textContent)) || null;
}

// Return a cached promise resolving to the publish Date or null
function fetchPublishDate(videoId) {
  if (dateCache.has(videoId)) return dateCache.get(videoId);
  const promise = requestPublishDate(videoId);
  dateCache.set(videoId, promise);
  return promise;
}

// Read innertube config from the page once so we can call the player endpoint
let innertubeConfig;
function getInnertubeConfig() {
  if (innertubeConfig) return innertubeConfig;
  const html = document.documentElement.innerHTML;
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1]
    || html.match(/"clientVersion":"([\d.]+)"/)?.[1] || '2.20240101.00.00';
  innertubeConfig = { key, clientVersion };
  return innertubeConfig;
}

// Query the internal player endpoint for a single short's publish date
async function requestPublishDate(videoId) {
  try {
    const { key, clientVersion } = getInnertubeConfig();
    const res = await fetch(`/youtubei/v1/player?key=${key}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion } }, videoId })
    });
    const data = await res.json();
    const published = data?.microformat?.playerMicroformatRenderer?.publishDate;
    return published ? new Date(published) : null;
  } catch {
    return null;
  }
}

// Format a date as a YouTube-style relative string like 4 days ago
function formatTimeAgo(date) {
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1]
  ];
  for (const [name, size] of units) {
    const value = Math.floor(seconds / size);
    if (value >= 1) return `${value} ${name}${value > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

// Mimic native YouTube API calls to modify user playlists
function executeYouTubeCommand(action, videoId) {
  const appElement = document.querySelector("ytd-app");
  if (!appElement) return;

  const isAdd = action === 'add-to-watch-later';

  // Construct the payload required for the playlist edit endpoint
  const baseParams = {
    clickTrackingParams: "",
    commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: "/youtubei/v1/browse/edit_playlist" } },
    playlistEditEndpoint: {
      playlistId: "WL",
      actions: [{
        [isAdd ? 'addedVideoId' : 'removedVideoId']: videoId,
        action: isAdd ? "ACTION_ADD_VIDEO" : "ACTION_REMOVE_VIDEO_BY_VIDEO_ID"
      }]
    }
  };

  // Dispatch a custom yt-action event to trigger the backend request
  appElement.dispatchEvent(new CustomEvent("yt-action", {
    detail: { actionName: "yt-service-request", returnValue: [], args: [{ data: {} }, baseParams], optionalAction: false }
  }));
}

// Helper to check URL and inject buttons
function checkAndInject(url, delay = 0) {
  if (url.includes('/shorts')) {
    console.log('Injecting watch later buttons into the YouTube shorts page.');
    delay ? setTimeout(injectWatchLaterButtons, delay) : injectWatchLaterButtons();
  }
}

// Observe DOM for infinite scrolling and handle navigation
new MutationObserver(injectWatchLaterButtons).observe(document.body, { childList: true, subtree: true });

// Inject buttons on initial page load if navigating directly to Shorts
window.addEventListener('load', () => checkAndInject(location.href));

// Re-inject buttons after client-side routing finishes loading the new DOM
window.navigation.addEventListener("navigate", (event) => checkAndInject(event.destination.url, 1000));