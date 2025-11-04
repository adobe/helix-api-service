/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import xml2js from 'xml2js';
import { MP4Parser } from '@adobe/helix-mediahandler';
import { FileSizeFormatter, formatDuration, toSISize } from '../support/utils.js';
import { error } from '../contentproxy/errors.js';

const XML_PROLOG = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>');

/**
 * Bit rate limit in videos.
 */
const BIT_RATE_LIMIT = 301 * 1024;

/**
 * ICO file size limit.
 * 32x32 for favicon can be up to 4Kb for 32bit color depth.
 * Use 16Kb limit to leave room for 48x48 32bit.
 */
const ICO_SIZE_LIMIT = 16 * 1024;

/**
 * SVG file size limit.
 */
const SVG_SIZE_LIMIT = 40 * 1024;

/**
 * PDF file size limit.
 */
const PDF_SIZE_LIMIT = 20 * 1024 * 1024; // 20MB

/**
 * Image file size limit.
 */
const IMAGE_SIZE_LIMIT = 20 * 1024 * 1024; // 20MB

/**
 * Error information with code and message.
 */
export class ValidationError extends Error {
  code;

  /**
   * @param {ErrorInfo} errorInfo
   */
  constructor(errorInfo, reason) {
    super(errorInfo.message);
    this.code = errorInfo.code;
    if (reason) {
      this.reason = reason;
    }
  }
}

function getLimit(config, property, def) {
  const limit = Number.parseInt(config.limits?.preview?.[property], 10);
  return Number.isNaN(limit) ? def : limit;
}

/**
 * Prepend XML prolog to an SVG resource if necessary.
 *
 * @param buf {Buffer}
 * @returns buffer prepended by XML prolog
 */
function prependProlog(buf) {
  const startsWith = (b, s) => {
    const p = [...s].map((c) => c.charCodeAt(0));
    if (b.length < p.length) {
      return false;
    }
    for (let i = 0; i < p.length; i += 1) {
      if (b[i] !== p[i]) {
        return false;
      }
    }
    return true;
  };
  if (startsWith(buf, '<svg ')) {
    return Buffer.concat([XML_PROLOG, buf]);
  }
  return buf;
}

/**
 * Validate SVG. Checks whether neither script tags nor on attributes are contained.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} resourcePath resource path
 * @param {Buffer} buf buffer
 * @throws {ValidationError} if an error occurs
 */
async function validateSVG(context, resourcePath, buf) {
  const { log, config } = context;
  const $1 = resourcePath;

  const limit = getLimit(config, 'maxSVGSize', SVG_SIZE_LIMIT);
  if (buf.byteLength > limit) {
    const $2 = toSISize(limit, 0);
    const $3 = toSISize(buf.byteLength, 1);

    throw new ValidationError(
      error('Unable to preview \'$1\': SVG is larger than $2: $3', $1, $2, $3),
      `SVG is larger than ${$2}: ${$3}`,
    );
  }

  const checkForScriptOrHandlers = (node, path) => {
    if (node.script || node.$?.on) {
      const $2 = path;

      throw new ValidationError(
        error('Unable to preview \'$1\': Script or event handler detected in SVG at: $2', $1, $2),
        `Script or event handler detected in SVG at: ${$2}`,
      );
    }
    Object.getOwnPropertyNames(node)
      .filter((name) => Array.isArray(node[name]))
      .forEach((name) => node[name].forEach((child, index) => checkForScriptOrHandlers(child, `${path}/${name}[${index}]`)));
  };

  let xml;

  try {
    xml = await xml2js.parseStringPromise(buf.toString('utf-8'), {
      strict: false, // allow escaped entity names, e.g. '&ns_extend;'
      normalizeTags: true, // lowercase all tag names
    });
    /* c8 ignore next 7 */
  } catch (e) {
    log.info(`Parsing SVG threw an error: ${e.message}`);
    throw new ValidationError(
      error('Unable to preview \'$1\': Unable to parse SVG XML', $1),
      'Unable to parse SVG XML',
    );
  }
  if (!xml?.svg) {
    throw new ValidationError(
      error('Unable to preview \'$1\': Expected XML content with an SVG root item', $1),
      'Expected XML content with an SVG root item',
    );
  }
  checkForScriptOrHandlers(xml.svg, '/svg');
}

/**
 * Validate MP4. Checks limits.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} resourcePath resource path
 * @param {Buffer} buf buffer
 * @throws {ValidationError} if an error occurs
 */
async function validateMP4(context, resourcePath, buf) {
  const $1 = resourcePath;

  const info = new MP4Parser(buf, context.log).parse(buf);
  if (info === null) {
    throw new ValidationError(
      error('Unable to preview \'$1\': Unable to parse MP4', $1),
      'Unable to parse MP4',
    );
  }
  if (info?.duration) {
    if (info.duration > 120) {
      const $2 = formatDuration(info.duration);

      throw new ValidationError(
        error('Unable to preview \'$1\': MP4 is longer than 2 minutes: $2', $1, $2),
        `MP4 is longer than 2 minutes: ${$2}`,
      );
    }
    const bitRate = Math.floor(buf.length / info.duration);
    if (bitRate >= BIT_RATE_LIMIT) {
      const $2 = FileSizeFormatter('en-US', {}).format(bitRate);

      throw new ValidationError(
        error('Unable to preview \'$1\': MP4 has a higher bitrate than 300 KB/s: $2', $1, $2),
        `MP4 has a higher bitrate than 300 KB/s: ${$2}`,
      );
    }
  }
}

/**
 * Validate ICO. Checks limits.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} resourcePath resource path
 * @param {Buffer} buf buffer
 * @throws {ValidationError} if an error occurs
 */
async function validateICO(context, resourcePath, buf) {
  const { config } = context;

  const limit = getLimit(config, 'maxICOSize', ICO_SIZE_LIMIT);
  if (buf.byteLength > limit) {
    const $1 = resourcePath;
    const $2 = toSISize(limit, 0);
    const $3 = toSISize(buf.byteLength, 1);

    throw new ValidationError(
      error('Unable to preview \'$1\': ICO is larger than $2: $3', $1, $2, $3),
      `ICO is larger than ${$2}: ${$3}`,
    );
  }
}

/**
 * Validate PDF. Checks limits.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} resourcePath resource path
 * @param {Buffer} buf buffer
 * @throws {ValidationError} if an error occurs
 */
async function validatePDF(context, resourcePath, buf) {
  const { config } = context;

  const limit = getLimit(config, 'maxPDFSize', PDF_SIZE_LIMIT);
  if (buf.byteLength > limit) {
    const $1 = resourcePath;
    const $2 = toSISize(limit, 0);
    const $3 = toSISize(buf.byteLength, 1);

    throw new ValidationError(
      error('Unable to preview \'$1\': PDF is larger than $2: $3', $1, $2, $3),
      `PDF is larger than ${$2}: ${$3}`,
    );
  }
}

/**
 * Validate default image. Checks limits.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} resourcePath resource path
 * @param {Buffer} buf buffer
 * @throws {StatusCodeError} if an error occurs
 */
async function validateImage(context, resourcePath, buf) {
  const { config } = context;

  const limit = getLimit(config, 'maxImageSize', IMAGE_SIZE_LIMIT);
  if (buf.byteLength > limit) {
    const $1 = resourcePath;
    const $2 = toSISize(limit, 0);
    const $3 = toSISize(buf.byteLength, 1);

    throw new ValidationError(
      error('Unable to preview \'$1\': Image is larger than $2: $3', $1, $2, $3),
      `Image is larger than ${$2}: ${$3}`,
    );
  }
}

/**
 * @callback Preprocess
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>} preprocessed buffer
 *
 * @callback Validate
 * @param {import('../support/AdminContext.js').AdminContext} context context
 * @param {string} resourcePath resource path
 * @param {Buffer} buffer buffer
 * @returns {Promise<void>} if validation passed
 * @throws {ValidationError} if validation failed
 *
 * @typedef MediaType
 * @property {string} name
 * @property {string{}} extensions
 * @property {string} mime
 * @property {Preprocess} preprocess
 * @property {Validate} validate
 * @property {boolean} redirect
 */

/**
 * Media types we upload to the media bus and their description.
 */
/** @type {MediaType[]} */
export const MEDIA_TYPES = [
  {
    name: 'SVG',
    extensions: ['.svg'],
    mime: 'application/xml',
    preprocess: prependProlog,
    validate: validateSVG,
  },
  {
    name: 'PNG',
    extensions: ['.png'],
    mime: 'image/png',
    redirect: true,
    validate: validateImage,
  },
  {
    name: 'JPG',
    extensions: ['.jpg', '.jpeg'],
    mime: 'image/jpeg',
    redirect: true,
    validate: validateImage,
  },
  {
    name: 'GIF',
    extensions: ['.gif'],
    mime: 'image/gif',
    redirect: true,
    validate: validateImage,
  },
  {
    name: 'MP4',
    extensions: ['.mp4'],
    mime: 'video/mp4',
    validate: validateMP4,
    redirect: true,
  },
  {
    name: 'ICO',
    extensions: ['.ico'],
    mime: 'image/x-icon',
    validate: validateICO,
    redirect: true,
  },
  {
    name: 'PDF',
    extensions: ['.pdf'],
    mime: 'application/pdf',
    validate: validatePDF,
    redirect: false,
  },
];
