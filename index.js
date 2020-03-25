const puppeteer = require('puppeteer');
const axios = require('axios').default;
const ExifImage = require('exif').ExifImage;
const seed = 'https://en.wikipedia.org/wiki/List_of_most_popular_websites'
const visitedUrls = new Set()
const doneWithUrls = new Set()
const visitedImages = new Set()
const maxImages = 100000
let exifImages = 0
const maxUrlsPerDomain = 120
const queue = []
const URL = require('url')
const fs = require('fs')
const out = "out.txt"
const numPages = 10
const availablePages = new Set()
let resolveAll = null
async function initPage(browser)
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 })
  return page
}

function getHostname(u)
{
  return (/(?<=.*)[^.]+\.[^.]+$/.exec(URL.parse(u).hostname) || [u]) [0]
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

function enqueue(nextUrl) {
  if (!nextUrl)
    return

  if (visitedUrls.has(nextUrl))
    return

  const hostname = getHostname(nextUrl)
  if (doneWithUrls.has(hostname))
    return

  visitedUrls.add(nextUrl)
  const count = Array.from(visitedUrls).filter(u => getHostname(u) === hostname).length
  if (count >= maxUrlsPerDomain)
    doneWithUrls.add(hostname)

  queue.push(nextUrl)
}

function tryLoadImage(info) {
  const {src} = info
  console.log(`Loading image ${src} from ${info.website}`)
  axios.get(src, {responseType: 'arraybuffer'}).then(response => {
    new ExifImage({image: response.data}, (err, exif) => {
      let data = {...info}
      Object.keys(exif || {}).forEach(category => {
        data = Object.keys(exif[category])
          .map(key => ({[`exif-${category}-${key}`]: exif[category][key]}))
          .reduce((a, o) => Object.assign(a, o), data)
      })

      fs.appendFileSync(out, `${JSON.stringify(data)},\n`)
    })
  }).catch(e => {
    console.error(e)
  })
}

async function loadWebsite(page, website) {
  try {
    console.log(`Loading ${website}`)
    await page.goto(website)
    const imageSources = shuffle(Array.from(new Set(await page.evaluate(() => 
      Array.from(document.images).filter(s => !s.src.endsWith('svg')).slice(0, 10).map(img => {
        const {src, naturalWidth, naturalHeight} = img
        const compStyle = getComputedStyle(img)
        const computedWidth = compStyle ? parseFloat(compStyle.width) : naturalWidth
        const computedHeight = compStyle ? (parseFloat(compStyle.height) || naturalHeight) : naturalHeight
          return {computedWidth, computedHeight, naturalWidth, naturalHeight, src}
      })))))
    const mainLink = await page.evaluate(() => Array.from(document.querySelectorAll('a')).find(a => a.innerText.toLowerCase() == 'official website'))
    if (mainLink) {
      enqueue(mainLink.href)
    } else {
      const links = shuffle(await page.evaluate(() => Array.from(new Set(Array.from(document.links).map(i => i.href)))))
      for (const link of links)
        enqueue(link)
    }

    (() => {
      if (website.startsWith('https://en.wikipedia.org/') || website.includes('wikimedia.org'))
        return

      for (const info of imageSources) {
        const {src} = info
        if (exifImages >= maxImages)
          return
        if (visitedImages.has(src))
          return
        visitedImages.add(src)
        tryLoadImage({...info, website})
      }
    })()

  } catch (e) {
    console.error(e)
  }
  availablePages.add(page)
}
function dequeue() {
  if (!queue.length)
    return
  if (!availablePages.size)
    return

  if (exifImages >= maxImages)
    resolveAll()

  const page = [...availablePages][0]
  availablePages.delete(page)  
  const website = queue.shift()
  loadWebsite(page, website).then(() => {
    shuffle(queue)
    dequeue()
  })
}


puppeteer.launch().then(async browser => {
  const pages = await Promise.all(Array(numPages).fill(0).map(() => initPage(browser)))
  pages.forEach(p => availablePages.add(p))
  enqueue(seed)
  dequeue()
  await new Promise(r => {resolveAll = r}) 
});