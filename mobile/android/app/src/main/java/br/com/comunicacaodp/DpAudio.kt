package br.com.comunicacaodp

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import java.io.File

/**
 * Mensagem de voz: grava pelo microfone (M4A/AAC, o formato nativo do Android)
 * e toca as mensagens da conversa (M4A do celular e WEBM/Opus do desktop).
 *
 * Um áudio por vez, tanto gravando quanto tocando. O estado do player vai para
 * o JavaScript por onStatus (JSON), a cada 250 ms enquanto toca.
 */
class DpAudio(private val context: Context, private val onStatus: (String) -> Unit) {

  private val main = Handler(Looper.getMainLooper())

  // ---------------------------------------------------------------- gravação

  private var recorder: MediaRecorder? = null
  private var arquivo: File? = null
  private var inicio = 0L

  @Synchronized
  fun startRecording() {
    cancelRecording()
    stop() // não grava com áudio tocando
    val pasta = File(context.cacheDir, "gravacoes").apply { mkdirs() }
    // Sobras de gravações antigas (enviadas ou descartadas)
    pasta.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 24 * 3600_000L) it.delete() }
    val destino = File(pasta, "voz-${System.currentTimeMillis()}.m4a")
    val novo = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
    try {
      novo.setAudioSource(MediaRecorder.AudioSource.MIC)
      novo.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      novo.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      novo.setAudioChannels(1)
      novo.setAudioSamplingRate(44100)
      novo.setAudioEncodingBitRate(48000)
      novo.setOutputFile(destino.absolutePath)
      novo.prepare()
      novo.start()
    } catch (e: Exception) {
      novo.release()
      destino.delete()
      throw IllegalStateException("Não foi possível usar o microfone.", e)
    }
    recorder = novo
    arquivo = destino
    inicio = SystemClock.elapsedRealtime()
  }

  /** Para e devolve {uri, name, mimeType, size, durationMs} */
  @Synchronized
  fun stopRecording(): String {
    val atual = recorder ?: throw IllegalStateException("Nenhuma gravação em andamento.")
    val destino = arquivo
    val duracao = SystemClock.elapsedRealtime() - inicio
    recorder = null
    arquivo = null
    try {
      atual.stop()
    } catch (e: RuntimeException) {
      // stop() logo depois do start(): nada foi gravado
      destino?.delete()
      throw IllegalStateException("A gravação ficou curta demais.", e)
    } finally {
      atual.release()
    }
    if (destino == null || !destino.exists() || destino.length() == 0L) throw IllegalStateException("A gravação ficou vazia.")
    return JSONObject()
      .put("uri", Uri.fromFile(destino).toString())
      .put("name", "mensagem-de-voz.m4a")
      .put("mimeType", "audio/mp4")
      .put("size", destino.length())
      .put("durationMs", duracao)
      .toString()
  }

  @Synchronized
  fun cancelRecording() {
    val atual = recorder ?: return
    recorder = null
    try {
      atual.stop()
    } catch (_: RuntimeException) {
    }
    atual.release()
    arquivo?.delete()
    arquivo = null
  }

  /** 0..1, para o indicador de volume enquanto grava */
  @Synchronized
  fun level(): Double {
    val atual = recorder ?: return 0.0
    return try {
      (atual.maxAmplitude / 32767.0).coerceIn(0.0, 1.0)
    } catch (_: Exception) {
      0.0
    }
  }

  // ---------------------------------------------------------------- player

  private var player: MediaPlayer? = null
  private var tocandoId: String? = null
  private var duracaoConhecida = 0
  /** Antes do prepare, perguntar a posição ao MediaPlayer vira erro (-38) */
  private var preparado = false

  private val tique =
    object : Runnable {
      override fun run() {
        val atual = player ?: return
        if (atual.isPlaying) {
          status("tocando")
          main.postDelayed(this, 250)
        }
      }
    }

  private fun status(estado: String, id: String? = tocandoId, mensagem: String = "") {
    val atual = player
    val posicao = try {
      if (preparado) atual?.currentPosition ?: 0 else 0
    } catch (_: Exception) {
      0
    }
    onStatus(
      JSONObject()
        .put("id", id ?: "")
        .put("estado", estado)
        .put("posicaoMs", posicao)
        .put("duracaoMs", duracaoConhecida)
        .put("mensagem", mensagem)
        .toString(),
    )
  }

  /** Toca o áudio do endereço (com o token no cabeçalho). id volta nos avisos de estado */
  fun play(url: String, token: String, id: String, inicioMs: Int) {
    main.post {
      if (tocandoId == id && player != null && !preparado) return@post // ainda carregando
      if (tocandoId == id && player != null) {
        // Mesmo áudio pausado: continua de onde parou
        player?.let {
          if (inicioMs > 0) it.seekTo(inicioMs)
          it.start()
        }
        status("tocando")
        main.removeCallbacks(tique)
        main.post(tique)
        return@post
      }
      liberar("parado")
      val novo = MediaPlayer()
      player = novo
      tocandoId = id
      duracaoConhecida = 0
      preparado = false
      novo.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      novo.setOnPreparedListener {
        if (player !== it) return@setOnPreparedListener
        preparado = true
        duracaoConhecida = it.duration.coerceAtLeast(0)
        if (inicioMs > 0) it.seekTo(inicioMs)
        it.start()
        status("tocando")
        main.post(tique)
      }
      novo.setOnCompletionListener {
        if (player !== it) return@setOnCompletionListener
        main.removeCallbacks(tique)
        onStatus(JSONObject().put("id", tocandoId).put("estado", "fim").put("posicaoMs", 0).put("duracaoMs", duracaoConhecida).put("mensagem", "").toString())
        liberar(null)
      }
      novo.setOnErrorListener { mp, _, _ ->
        if (player === mp) {
          status("erro", mensagem = "Não foi possível tocar o áudio.")
          liberar(null)
        }
        true
      }
      try {
        val cabecalhos = if (token.isNotEmpty()) mapOf("Authorization" to "Bearer $token") else emptyMap()
        novo.setDataSource(context, Uri.parse(url), cabecalhos)
        status("carregando")
        novo.prepareAsync()
      } catch (e: Exception) {
        status("erro", mensagem = "Não foi possível tocar o áudio.")
        liberar(null)
      }
    }
  }

  fun pause() {
    main.post {
      val atual = player ?: return@post
      if (!preparado) {
        liberar("parado")
        return@post
      }
      if (atual.isPlaying) atual.pause()
      main.removeCallbacks(tique)
      status("pausado")
    }
  }

  fun seek(posicaoMs: Int) {
    main.post {
      val atual = player ?: return@post
      if (!preparado) return@post
      try {
        atual.seekTo(posicaoMs)
      } catch (_: Exception) {
      }
      status(if (atual.isPlaying) "tocando" else "pausado")
    }
  }

  fun stop() {
    main.post { liberar("parado") }
  }

  /** estadoFinal: aviso para o JavaScript antes de soltar (null = já avisou) */
  private fun liberar(estadoFinal: String?) {
    main.removeCallbacks(tique)
    val atual = player ?: return
    if (estadoFinal != null) status(estadoFinal)
    player = null
    tocandoId = null
    preparado = false
    try {
      atual.reset()
    } catch (_: Exception) {
    }
    atual.release()
  }
}
