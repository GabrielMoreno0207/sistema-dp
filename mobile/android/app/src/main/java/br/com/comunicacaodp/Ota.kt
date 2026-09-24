package br.com.comunicacaodp

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipInputStream

/**
 * Atualização rápida (como o Expo Updates): troca só o JavaScript do app, sem
 * reinstalar o APK. O pacote publicado no versionador ("mobile-ota") é um .zip com:
 *
 *   ota.json               {"versao": "2.1.1", "runtime": 1}
 *   index.android.bundle   o JavaScript do app
 *   drawable-(tamanho)     imagens usadas pelo JavaScript
 *
 * Ficam em filesDir/ota/<versao>/. O app carrega esse bundle no lugar do que veio
 * no APK (MainApplication -> bundlePath).
 *
 * Proteções:
 *  - runtime: o pacote só é aceito se foi feito para a mesma parte nativa (OTA_RUNTIME).
 *    Mudou código Kotlin, permissão ou biblioteca nativa? Sobe o otaRuntime e gera APK.
 *  - APK novo instalado: descarta a atualização rápida (o APK já traz o JavaScript dele).
 *  - Versão que não abre: se o JavaScript não confirmar (confirm) em algumas aberturas,
 *    o app volta sozinho para o JavaScript do APK e não aceita mais aquela versão.
 */
object Ota {
  private const val TAG = "DpOta"
  private const val MAX_TENTATIVAS = 3
  const val BUNDLE = "index.android.bundle"

  val runtime: Int get() = BuildConfig.OTA_RUNTIME

  private fun pasta(context: Context) = File(context.filesDir, "ota")
  private fun arquivoEstado(context: Context) = File(pasta(context), "estado.json")

  private fun versionCode(context: Context): Long {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
  }

  private fun lerEstado(context: Context): JSONObject =
    try {
      JSONObject(arquivoEstado(context).readText())
    } catch (_: Exception) {
      JSONObject()
    }

  private fun gravarEstado(context: Context, estado: JSONObject) {
    val destino = arquivoEstado(context)
    destino.parentFile?.mkdirs()
    val temporario = File(destino.path + ".tmp")
    temporario.writeText(estado.toString())
    if (!temporario.renameTo(destino)) {
      destino.delete()
      temporario.renameTo(destino)
    }
  }

  private fun ruins(estado: JSONObject): MutableList<String> {
    val lista = estado.optJSONArray("ruins") ?: JSONArray()
    return MutableList(lista.length()) { lista.getString(it) }
  }

  /** Apaga as pastas de versão, menos a indicada */
  private fun limparVersoes(context: Context, manter: String?) {
    pasta(context).listFiles()?.forEach { f ->
      if (f.isDirectory && f.name != manter) f.deleteRecursively()
    }
  }

  /** Volta para o JavaScript do APK. ruim = essa versão não abre mais */
  private fun desativar(context: Context, estado: JSONObject, ruim: String?) {
    val lista = ruins(estado)
    if (ruim != null && ruim !in lista) lista.add(ruim)
    val novo = JSONObject().put("ruins", JSONArray(lista.takeLast(20)))
    gravarEstado(context, novo)
    limparVersoes(context, null)
  }

  /**
   * Chamado uma vez quando o app abre: caminho do bundle baixado, ou null para
   * usar o que veio no APK.
   */
  @Synchronized
  fun bundlePath(context: Context): String? {
    if (BuildConfig.DEBUG) return null
    return try {
      val estado = lerEstado(context)
      val ativa = estado.optString("ativa", "")
      if (ativa.isEmpty()) return null
      if (estado.optLong("apk", -1) != versionCode(context) || estado.optInt("runtime", -1) != runtime) {
        Log.i(TAG, "APK mudou: descartando a atualização rápida $ativa")
        desativar(context, estado, null)
        return null
      }
      val bundle = File(File(pasta(context), ativa), BUNDLE)
      if (!bundle.isFile) {
        desativar(context, estado, null)
        return null
      }
      if (!estado.optBoolean("confirmada", false)) {
        val tentativas = estado.optInt("tentativas", 0)
        if (tentativas >= MAX_TENTATIVAS) {
          Log.w(TAG, "A versão $ativa não abriu: voltando para o JavaScript do APK")
          desativar(context, estado, ativa)
          return null
        }
        gravarEstado(context, estado.put("tentativas", tentativas + 1))
      }
      bundle.absolutePath
    } catch (e: Exception) {
      Log.e(TAG, "Falha ao ler a atualização rápida", e)
      null
    }
  }

  /** O JavaScript abriu direito: a versão fica */
  @Synchronized
  fun confirm(context: Context) {
    val estado = lerEstado(context)
    if (estado.optString("ativa", "").isEmpty() || estado.optBoolean("confirmada", false)) return
    gravarEstado(context, estado.put("confirmada", true).put("tentativas", 0))
  }

  /** {runtime, ativa (versão do JavaScript baixado ou ""), ruins} */
  fun info(context: Context): JSONObject {
    val estado = lerEstado(context)
    val ativa = estado.optString("ativa", "")
    val valida = ativa.isNotEmpty() && estado.optLong("apk", -1) == versionCode(context)
    return JSONObject()
      .put("runtime", runtime)
      .put("ativa", if (valida) ativa else "")
      .put("ruins", JSONArray(ruins(estado)))
  }

  /**
   * Extrai o .zip baixado e deixa a versão pronta para a próxima abertura.
   * Devolve a versão instalada. Erros vêm com mensagem para a pessoa.
   */
  @Synchronized
  fun install(context: Context, zip: File): String {
    val raiz = pasta(context)
    raiz.mkdirs()
    val temporaria = File(raiz, "_extraindo")
    temporaria.deleteRecursively()
    temporaria.mkdirs()
    val base = temporaria.canonicalPath + File.separator
    try {
      ZipInputStream(zip.inputStream().buffered()).use { entrada ->
        while (true) {
          val item = entrada.nextEntry ?: break
          val destino = File(temporaria, item.name)
          // Nada de "../" escapando da pasta
          if (!destino.canonicalPath.startsWith(base)) throw IllegalStateException("Pacote de atualização inválido.")
          if (item.isDirectory) {
            destino.mkdirs()
          } else {
            destino.parentFile?.mkdirs()
            destino.outputStream().use { entrada.copyTo(it) }
          }
        }
      }
      val manifesto = try {
        JSONObject(File(temporaria, "ota.json").readText())
      } catch (_: Exception) {
        throw IllegalStateException("Pacote de atualização inválido (sem ota.json).")
      }
      val versao = manifesto.optString("versao", "")
      if (!Regex("^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}$").matches(versao)) throw IllegalStateException("Pacote de atualização inválido (versão).")
      if (manifesto.optInt("runtime", -1) != runtime) {
        throw IllegalStateException("A versão $versao precisa do aplicativo novo. Atualize o app pelo APK.")
      }
      if (!File(temporaria, BUNDLE).isFile) throw IllegalStateException("Pacote de atualização inválido (sem o JavaScript).")
      val estado = lerEstado(context)
      if (versao in ruins(estado)) throw IllegalStateException("A versão $versao não abriu neste celular e foi descartada.")

      val destino = File(raiz, versao)
      destino.deleteRecursively()
      if (!temporaria.renameTo(destino)) throw IllegalStateException("Não foi possível instalar a atualização.")
      estado.put("ativa", versao)
        .put("confirmada", false)
        .put("tentativas", 0)
        .put("apk", versionCode(context))
        .put("runtime", runtime)
      gravarEstado(context, estado)
      limparVersoes(context, versao)
      return versao
    } finally {
      temporaria.deleteRecursively()
    }
  }

  /**
   * Fecha e abre o app de novo (carrega o JavaScript novo). Quem reabre é a
   * ReiniciarActivity, que roda num processo separado, porque este vai ser encerrado.
   */
  fun restart(context: Context) {
    val intent = android.content.Intent(context, ReiniciarActivity::class.java)
      .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      .putExtra(ReiniciarActivity.EXTRA_PID, android.os.Process.myPid())
    context.startActivity(intent)
  }

}
