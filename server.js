/**
 * BACKEND - GRAVADOR DE REUNIÕES COM OPENAI
 * 
 * APIs:
 * - POST /transcribe - Transcreve áudio com Whisper
 * - POST /generate-minutes - Gera ata com GPT-4
 * - POST /process-meeting - Transcreve + Gera ata (tudo de uma vez)
 */

const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ========================================
// CONFIGURAÇÃO
// ========================================

const app = express();
const PORT = process.env.PORT || 3000;

// Verifica se API key existe
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ ERRO: OPENAI_API_KEY não configurada no .env');
    console.error('👉 Crie arquivo .env com: OPENAI_API_KEY=sk-...');
    process.exit(1);
}

// Inicializa OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());

// Configuração de upload (50MB max)
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ========================================
// ROTA: HEALTH CHECK
// ========================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        openai: process.env.OPENAI_API_KEY ? 'connected' : 'not configured'
    });
});

// ========================================
// ROTA: TRANSCREVER ÁUDIO
// ========================================

app.post('/transcribe', upload.single('audio'), async (req, res) => {
    const startTime = Date.now();
    
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        console.log(`📁 Arquivo recebido: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

        // Transcreve com Whisper
        console.log('🎤 Iniciando transcrição com Whisper...');
        
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(req.file.path),
            model: 'whisper-1',
            language: 'pt',
            response_format: 'verbose_json',
            timestamp_granularities: ['word']
        });

        console.log(`✅ Transcrição concluída (${transcription.text.split(' ').length} palavras)`);

        // Deleta arquivo temporário
        fs.unlinkSync(req.file.path);
        console.log('🗑️ Arquivo temporário deletado');

        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⏱️ Tempo de processamento: ${processingTime}s\n`);

        res.json({
            success: true,
            transcription: transcription.text,
            words: transcription.words,
            duration: transcription.duration,
            processingTime: parseFloat(processingTime)
        });

    } catch (error) {
        console.error('❌ Erro na transcrição:', error.message);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            error: 'Erro ao transcrever áudio',
            details: error.message
        });
    }
});

// ========================================
// ROTA: GERAR ATA COM GPT-4
// ========================================

app.post('/generate-minutes', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { transcription, meetingDate, startTime: meetingStartTime, endTime: meetingEndTime } = req.body;

        if (!transcription) {
            return res.status(400).json({ error: 'Transcrição não fornecida' });
        }

        console.log('🤖 Gerando ata com GPT-4o...');

        const prompt = `Você é um assistente especializado em gerar atas de reunião profissionais e estruturadas.

TRANSCRIÇÃO DA REUNIÃO:
${transcription}

INFORMAÇÕES ADICIONAIS:
- Data: ${meetingDate || 'Não informada'}
- Horário: ${meetingStartTime || 'Não informado'} - ${meetingEndTime || 'Não informado'}

INSTRUÇÕES:
Analise a transcrição acima e gere uma ata de reunião estruturada em formato JSON com os seguintes campos:

{
  "resumo_executivo": "Resumo de 2-3 frases sobre o que foi discutido",
  "participantes": ["nome1", "nome2", ...],
  "topicos_discutidos": [
    {
      "titulo": "Título do tópico",
      "descricao": "Descrição detalhada do que foi discutido"
    }
  ],
  "decisoes_tomadas": [
    {
      "decisao": "Descrição da decisão",
      "responsavel": "Nome do responsável (se mencionado)",
      "prazo": "Prazo mencionado (se houver)"
    }
  ],
  "encaminhamentos": [
    {
      "tarefa": "Descrição da tarefa",
      "responsavel": "Nome do responsável",
      "prazo": "Prazo (se mencionado)"
    }
  ],
  "observacoes": "Quaisquer observações relevantes não categorizadas acima"
}

REGRAS IMPORTANTES:
1. Seja preciso e baseie-se APENAS no que foi dito na transcrição
2. Se um campo não tiver informação, use array vazio [] ou string vazia ""
3. Identifique participantes pelos nomes mencionados na conversa
4. Capture decisões explícitas (palavras como: decidimos, vamos, ficou definido)
5. Identifique encaminhamentos com responsáveis e prazos quando mencionados
6. Mantenha tom profissional e objetivo
7. Retorne APENAS o JSON, sem texto adicional antes ou depois`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'Você é um assistente especializado em gerar atas de reunião estruturadas.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' }
        });

        const minutes = JSON.parse(completion.choices[0].message.content);

        console.log('✅ Ata gerada com sucesso');
        
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⏱️ Tempo de processamento: ${processingTime}s\n`);

        res.json({
            success: true,
            minutes: minutes,
            processingTime: parseFloat(processingTime)
        });

    } catch (error) {
        console.error('❌ Erro ao gerar ata:', error.message);
        
        res.status(500).json({
            error: 'Erro ao gerar ata',
            details: error.message
        });
    }
});

// ========================================
// ROTA: PROCESSAR REUNIÃO COMPLETA
// ========================================

app.post('/process-meeting', upload.single('audio'), async (req, res) => {
    const startTime = Date.now();
    
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        console.log(`\n${'='.repeat(60)}`);
        console.log(`📋 PROCESSANDO REUNIÃO COMPLETA`);
        console.log(`${'='.repeat(60)}`);
        console.log(`📁 Arquivo: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

        const { meetingDate, startTime: meetingStartTime, endTime: meetingEndTime } = req.body;

        console.log('\n[1/2] 🎤 Transcrevendo com Whisper...');
        
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(req.file.path),
            model: 'whisper-1',
            language: 'pt',
            response_format: 'verbose_json',
            timestamp_granularities: ['word']
        });

        console.log(`✅ Transcrição: ${transcription.text.split(' ').length} palavras`);

        console.log('\n[2/2] 🤖 Gerando ata com GPT-4o...');

        const prompt = `Você é um assistente especializado em gerar atas de reunião profissionais e estruturadas.

TRANSCRIÇÃO DA REUNIÃO:
${transcription.text}

INFORMAÇÕES ADICIONAIS:
- Data: ${meetingDate || 'Não informada'}
- Horário: ${meetingStartTime || 'Não informado'} - ${meetingEndTime || 'Não informado'}
- Duração do áudio: ${transcription.duration.toFixed(0)} segundos

INSTRUÇÕES:
Analise a transcrição acima e gere uma ata de reunião estruturada em formato JSON com os seguintes campos:

{
  "resumo_executivo": "Resumo de 2-3 frases sobre o que foi discutido",
  "participantes": ["nome1", "nome2", ...],
  "topicos_discutidos": [
    {
      "titulo": "Título do tópico",
      "descricao": "Descrição detalhada do que foi discutido"
    }
  ],
  "decisoes_tomadas": [
    {
      "decisao": "Descrição da decisão",
      "responsavel": "Nome do responsável (se mencionado)",
      "prazo": "Prazo mencionado (se houver)"
    }
  ],
  "encaminhamentos": [
    {
      "tarefa": "Descrição da tarefa",
      "responsavel": "Nome do responsável",
      "prazo": "Prazo (se mencionado)"
    }
  ],
  "observacoes": "Quaisquer observações relevantes não categorizadas acima"
}

REGRAS IMPORTANTES:
1. Seja preciso e baseie-se APENAS no que foi dito na transcrição
2. Se um campo não tiver informação, use array vazio [] ou string vazia ""
3. Identifique participantes pelos nomes mencionados na conversa
4. Capture decisões explícitas (palavras como: decidimos, vamos, ficou definido)
5. Identifique encaminhamentos com responsáveis e prazos quando mencionados
6. Mantenha tom profissional e objetivo
7. Retorne APENAS o JSON, sem texto adicional antes ou depois`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'Você é um assistente especializado em gerar atas de reunião estruturadas.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' }
        });

        const minutes = JSON.parse(completion.choices[0].message.content);

        console.log('✅ Ata gerada com sucesso');

        fs.unlinkSync(req.file.path);
        console.log('\n🗑️ Arquivo temporário deletado');

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⏱️ Tempo total: ${totalTime}s`);
        console.log(`${'='.repeat(60)}\n`);

        res.json({
            success: true,
            transcription: transcription.text,
            words: transcription.words,
            duration: transcription.duration,
            minutes: minutes,
            processingTime: parseFloat(totalTime)
        });

    } catch (error) {
        console.error('❌ Erro ao processar reunião:', error.message);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            error: 'Erro ao processar reunião',
            details: error.message
        });
    }
});

// ========================================
// INICIALIZAÇÃO
// ========================================

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Backend rodando em http://localhost:${PORT}`);
    console.log(`✅ OpenAI configurado`);
    console.log(`${'='.repeat(60)}\n`);
    console.log('Endpoints disponíveis:');
    console.log(`  GET  /health              - Health check`);
    console.log(`  POST /transcribe          - Transcrever áudio`);
    console.log(`  POST /generate-minutes    - Gerar ata`);
    console.log(`  POST /process-meeting     - Processar tudo\n`);
});
