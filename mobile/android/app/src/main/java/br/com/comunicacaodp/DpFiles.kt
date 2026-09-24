package br.com.comunicacaodp

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Arquivos do app: enviar ao servidor, baixar, abrir em outro aplicativo,
 * preparar e recortar fotos e instalar a atualização.
 * Tudo aqui roda fora da thread principal (quem chama cuida disso).
 */
object DpFiles {
  const val AUTHORITY_SUFFIX = ".arquivos"
  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val READ_TIMEOUT_MS = 60_000

  fun authority(context: Context) = context.packageName + AUTHORITY_SUFFIX

  /** Nome, tipo e tamanho de um arquivo escolhido (content://) */
  fun describe(context: Context, uri: Uri): JSONObject {
    val resolver = context.contentResolver
    var name = uri.lastPathSegment ?: "arquivo"
    var size = -1L
    if (uri.scheme == ContentResolver.SCHEME_CONTENT) {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val s = c.getColumnIndex(OpenableColumns.SIZE)
          if (n >= 0 && !c.isNull(n)) name = c.getString(n)
          if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
        }
      }
    } else if (uri.scheme == "file") {
      val file = File(uri.path ?: "")
      name = file.name
      size = file.length()
    }
    var mime = resolver.getType(uri)
    if (mime.isNullOrBlank()) {
      val ext = name.substringAfterLast('.', "").lowercase()
      mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }
    return JSONObject().put("uri", uri.toString()).put("name", name).put("mimeType", mime).put("size", size)
  }

  /** Arquivo novo na pasta de cache, para a câmera gravar a foto */
  fun newCameraFile(context: Context): Pair<File, Uri> {
    val dir = File(context.cacheDir, "camera").apply { mkdirs() }
    val file = File(dir, "foto-${System.currentTimeMillis()}.jpg")
    return file to FileProvider.getUriForFile(context, authority(context), file)
  }

  /**
   * Envia o arquivo como corpo binário (é o que o servidor espera em /api/midias e
   * /api/attachments). Devolve {status, body} para o JavaScript tratar a resposta.
   */
  fun upload(context: Context, url: String, token: String, uri: Uri, mimeType: String, headers: JSONObject): JSONObject {
    val size = describe(context, uri).optLong("size", -1)
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "POST"
      conn.doOutput = true
      conn.connectTimeout = CONNECT_TIMEOUT_MS
      conn.readTimeout = READ_TIMEOUT_MS * 5
      conn.setRequestProperty("Content-Type", mimeType)
      conn.setRequestProperty("Accept", "application/json")
      if (token.isNotEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
      for (key in headers.keys()) conn.setRequestProperty(key, headers.getString(key))
      if (size > 0) conn.setFixedLengthStreamingMode(size) else conn.setChunkedStreamingMode(64 * 1024)
      val input = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Arquivo não encontrado")
      input.use { src -> conn.outputStream.use { dst -> src.copyTo(dst, 64 * 1024) } }
      return JSONObject().put("status", conn.responseCode).put("body", readBody(conn))
    } finally {
      conn.disconnect()
    }
  }

  private fun readBody(conn: HttpURLConnection): String {
    val stream = if (conn.responseCode >= 400) conn.errorStream else conn.inputStream
    return stream?.bufferedReader()?.use { it.readText() } ?: ""
  }

  /** Baixa para a pasta de cache (subpasta + nome) e devolve o caminho do arquivo */
  fun download(context: Context, url: String, token: String, folder: String, fileName: String): File {
    val dir = File(context.cacheDir, folder).apply { mkdirs() }
    val safe = fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120).ifBlank { "arquivo" }
    val target = File(dir, safe)
    val partial = File(dir, "$safe.parcial")
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = CONNECT_TIMEOUT_MS
      conn.readTimeout = READ_TIMEOUT_MS
      if (token.isNotEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
      val status = conn.responseCode
      if (status !in 200..299) throw IllegalStateException("O servidor respondeu $status")
      conn.inputStream.use { src -> FileOutputStream(partial).use { dst -> src.copyTo(dst, 64 * 1024) } }
      if (target.exists()) target.delete()
      if (!partial.renameTo(target)) throw IllegalStateException("Não foi possível gravar o arquivo")
      return target
    } finally {
      conn.disconnect()
      if (partial.exists()) partial.delete()
    }
  }

  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  /** Intent para abrir o arquivo em outro aplicativo (galeria, leitor de PDF, instalador) */
  fun viewIntent(context: Context, file: File, mimeType: String): Intent {
    val uri = FileProvider.getUriForFile(context, authority(context), file)
    return Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, mimeType)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  /**
   * Foto escolhida ou tirada: gira de acordo com o EXIF (câmera grava deitada) e
   * reduz para no máximo maxSide px. Devolve {uri, width, height} de um JPEG em cache,
   * já em pé, para a tela de enquadramento.
   */
  fun prepareImage(context: Context, uri: Uri, maxSide: Int): JSONObject {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalStateException("Não é uma imagem")

    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val decoded =
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: throw IllegalStateException("Não foi possível abrir a imagem")

    val rotation =
        try {
          resolver.openInputStream(uri)?.use {
            when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
              ExifInterface.ORIENTATION_ROTATE_90 -> 90f
              ExifInterface.ORIENTATION_ROTATE_180 -> 180f
              ExifInterface.ORIENTATION_ROTATE_270 -> 270f
              else -> 0f
            }
          } ?: 0f
        } catch (_: Exception) {
          0f
        }

    val scale = minOf(1f, maxSide.toFloat() / maxOf(decoded.width, decoded.height))
    val matrix = Matrix().apply {
      postScale(scale, scale)
      postRotate(rotation)
    }
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (upright !== decoded) decoded.recycle()

    val file = saveJpeg(context, upright, "preparada", 92)
    val result = JSONObject().put("uri", Uri.fromFile(file).toString()).put("width", upright.width).put("height", upright.height)
    upright.recycle()
    return result
  }

  /** Recorta o retângulo (em px da imagem preparada) e salva um quadrado outSize x outSize */
  fun crop(context: Context, uri: Uri, x: Int, y: Int, width: Int, height: Int, outSize: Int): File {
    val source =
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
            ?: throw IllegalStateException("Não foi possível abrir a imagem")
    val out = Bitmap.createBitmap(outSize, outSize, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(source, Rect(x, y, x + width, y + height), RectF(0f, 0f, outSize.toFloat(), outSize.toFloat()), null)
    source.recycle()
    val file = saveJpeg(context, out, "recorte", 90)
    out.recycle()
    return file
  }

  private fun saveJpeg(context: Context, bitmap: Bitmap, prefix: String, quality: Int): File {
    val dir = File(context.cacheDir, "fotos").apply { mkdirs() }
    // Apaga as sobras de preparações anteriores
    dir.listFiles()?.filter { it.name.startsWith(prefix) }?.forEach { it.delete() }
    val file = File(dir, "$prefix-${System.currentTimeMillis()}.jpg")
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }
    return file
  }
}
