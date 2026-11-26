// Génération d'image : envoie le prompt au serveur d'images (stable-diffusion.cpp, API /sdapi/v1/txt2img).
const { sdUrl, imageStyle } = require('../config');
const { post } = require('./http');

const negativePrompt = 'blurry, low quality, deformed, disfigured, extra limbs, text, watermark, signature';

async function generateImage(prompt) {
  const body = await post(`${sdUrl}/sdapi/v1/txt2img`, {
    prompt: `${prompt}, ${imageStyle}`,
    negative_prompt: negativePrompt,
  }, 600000);
  return Buffer.from(body.images[0], 'base64');
}

module.exports = { generateImage };
