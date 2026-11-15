import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HTTPRequest, Page } from 'puppeteer-core'
import sharp from 'sharp'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'
import type { Frame } from '../shared/types'

describe.skipIf(!findBrowserPath())('frames drawn as images', () => {
  let browser: TestBrowser
  let page: Page
  beforeAll(async () => {
    browser = await openBrowser()
    page = await browser.newPage()
    page.setDefaultTimeout(5_000)
    await page.setViewport({ width: 1000, height: 900 })
    await page.goto(fixtureUrl('elementContextMenu.html'))
    await page.waitForFunction(() => !!window.contextMenuHarness?.drawAsImage)
  }, 60_000)
  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  it('selects the frame on a surface click and brings its document in', async () => {
    const frame: Frame = {
      id: 'f',
      canvasId: 'c',
      name: 'Image',
      x: 40,
      y: 60,
      width: 600,
      height: 400,
      createdAt: 0,
      updatedAt: 0,
      updatedBy: 'Tester',
      html: '<!doctype html><html><body><p id="target">Pick me</p></body></html>',
    }
    await page.evaluate((f) => {
      window.contextMenuHarness.seed([f])
      window.contextMenuHarness.drawAsImage(true)
    }, frame)
    await page.waitForSelector('img[src^="/i/f.jpg"]')
    expect(await page.$('iframe')).toBeNull()

    /* the element-move path waits for a document an image does not have,
       and gave up after two seconds with nothing selected */
    await page.mouse.click(frame.x + 300, frame.y + 200)
    await page.waitForFunction(() => window.contextMenuHarness.selectedIds().includes('f'), { timeout: 1_000 })
    const document = (await (await page.waitForSelector('iframe'))!.contentFrame())!
    await document.waitForSelector('#target')
  })

  it('paints the image above the frame’s white fill', async () => {
    /* the fixture server has no /i/ route: it gets a red picture here, so the
       pixel on screen tells the image from the white fill drawn under it */
    const red = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer()
    const answer = (request: HTTPRequest) => {
      if (new URL(request.url()).pathname.startsWith('/i/'))
        void request.respond({ status: 200, contentType: 'image/png', body: red })
      else void request.continue()
    }
    await page.setRequestInterception(true)
    page.on('request', answer)
    try {
      const frame: Frame = {
        id: 'red',
        canvasId: 'c',
        name: 'Zoomed out',
        x: 40,
        y: 60,
        width: 600,
        height: 400,
        createdAt: 0,
        updatedAt: 0,
        updatedBy: 'Tester',
        html: '<!doctype html><html><body><p>Seen from afar</p></body></html>',
      }
      await page.evaluate((f) => {
        window.contextMenuHarness.seed([f])
        window.contextMenuHarness.drawAsImage(true)
      }, frame)
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('img[src^="/i/red.jpg"]')
        return !!image?.complete && image.naturalWidth > 0
      })
      const shot = await page.screenshot({ clip: { x: frame.x + 300, y: frame.y + 200, width: 1, height: 1 } })
      const { data } = await sharp(shot).raw().toBuffer({ resolveWithObject: true })
      /* a static image painted under the fill's absolute ::before: white */
      expect(data[0]).toBeGreaterThan(200)
      expect(data[1]).toBeLessThan(60)
      expect(data[2]).toBeLessThan(60)
    } finally {
      page.off('request', answer)
      await page.setRequestInterception(false)
    }
  })
})
