/**
 * feedme2 LVGL 9 configuration. Tuned for the CrowPanel 240×240 GC9A01
 * round display + rotary encoder. Plan §11 unified menu component
 * needs: lv_arc, lv_label long-scroll, encoder input, montserrat 14/22.
 */
#ifndef LV_CONF_H
#define LV_CONF_H

#include <stdint.h>

#define LV_COLOR_DEPTH         16

/* lv_malloc is the C heap, not LVGL's built-in 64 KB static pool (LV_MEM_POOL_EXPAND_SIZE 0).
 * lodepng decodes a 130 px cat through lv_malloc into 130*130*4 = 67 600 B of ARGB8888 plus a
 * scanline buffer of the same size (~135 KB peak), so every decoder_open failed silently and no
 * cat ever rendered (review of 944eedc). With -DBOARD_HAS_PSRAM the Arduino core builds
 * CONFIG_SPIRAM_USE_MALLOC with a 4 KB always-internal threshold: those buffers land in the
 * 8 MB PSRAM, the widgets' small allocations stay in internal RAM. */
#define LV_USE_STDLIB_MALLOC   LV_STDLIB_CLIB
#define LV_USE_STDLIB_STRING   LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF  LV_STDLIB_CLIB

/* Warnings and errors reach the serial console through the callback main.cpp registers with
 * lv_log_register_print_cb (no printf: the SerialLogSink owns the port). */
#define LV_USE_LOG             1
#define LV_LOG_LEVEL           LV_LOG_LEVEL_WARN
#define LV_LOG_PRINTF          0

/* Decoded-image cache off: the cat PNGs are drawn once per screen and PSRAM is not worth spending on a cache. */
#define LV_CACHE_DEF_SIZE      0

/* No LV_TICK_CUSTOM: LVGL 9 dropped it. main.cpp registers the tick with lv_tick_set_cb(millis). */

/* ── widgets ──────────────────────────────────────────────── */
#define LV_USE_ARC             1
#define LV_USE_LABEL           1
#define LV_USE_BUTTON          1
#define LV_USE_LIST            1
#define LV_USE_ROLLER          1
#define LV_USE_SLIDER          1
#define LV_USE_BAR             1
#define LV_USE_DROPDOWN        1
#define LV_USE_FLEX            1
#define LV_USE_QRCODE          1
#define LV_USE_IMAGE           1
#define LV_USE_LODEPNG         1   /* PNG decode for the cat images */

/* ── fonts ────────────────────────────────────────────────── */
/* 10/12 added in dev-23 so the mini task pill renders its title at
 * a clearly smaller scale than the detail card without resorting to
 * lv_obj_set_style_transform_scale (which produces fuzzy output for
 * text and the status-arc avatar). */
#define LV_FONT_MONTSERRAT_10  1
#define LV_FONT_MONTSERRAT_12  1
#define LV_FONT_MONTSERRAT_14  1
#define LV_FONT_MONTSERRAT_18  1
#define LV_FONT_MONTSERRAT_22  1
#define LV_FONT_MONTSERRAT_24  1
#define LV_FONT_MONTSERRAT_48  1
#define LV_FONT_DEFAULT        &lv_font_montserrat_14

#endif /* LV_CONF_H */
