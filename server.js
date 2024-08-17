const express = require('express');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const port = 3000;

app.use(express.json());

// Credenciais para autenticação Basic
const username = 'clinicaespacointegrarsaude.rj@gmail.com';
const password = '#978341TaB';
const auth = Buffer.from(`${username}:${password}`).toString('base64');

// Função para formatar data e hora
const formatDateTime = (dateTime) => {
    const date = new Date(dateTime);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} às ${hours}:${minutes}`;
};

// Função para formatar número de telefone
const formatPhoneNumber = (phoneNumber) => {
    return phoneNumber
        .replace(/\D/g, '') // Remove todos os caracteres não numéricos
        .replace(/^0/, '55'); // Adiciona o código do país se necessário
};

// Função para buscar horários ocupados
const fetchHorariosOcupados = async (idAgendavel) => {
    try {
        const response = await axios.get(`https://app.conclinica.com.br/api/agenda/horariosocupados?idItemAgendavel=${idAgendavel}&dataInicio=01/01/2024&dataFim=01/01/2030`, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });
        return response.data || [];
    } catch (error) {
        console.error(`Erro ao buscar horários ocupados para ID ${idAgendavel}:`, error);
        return [];
    }
};

// Função para buscar e filtrar consultas do dia seguinte
const getConsultasAmanha = async () => {
    try {
        const response = await axios.get('https://app.conclinica.com.br/api/itensagendaveis', {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });
        const data = response.data;
        const consultasAmanha = [];

        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        for (const item of data) {
            const horariosOcupados = await fetchHorariosOcupados(item.id);
            for (const horario of horariosOcupados) {
                const consultaData = new Date(horario.inicio).toISOString().split('T')[0];
                if (consultaData === tomorrowStr && horario.primeiroAtendimento) {
                    consultasAmanha.push({
                        ...horario,
                        profissional: item.itemAgendavelWs || { nome: 'Desconhecido' },
                        pacienteWs: horario.pacienteWs || { nome: 'Desconhecido', telefone: '0000000000' }
                    });
                }
            }
        }

        return consultasAmanha;
    } catch (error) {
        console.error('Erro ao buscar consultas do dia seguinte:', error);
        return [];
    }
};

// Função para obter o número de telefone do paciente
const getPacienteTelefone = async (idPaciente) => {
    try {
        const response = await axios.get(`https://app.conclinica.com.br/api/pacientes/${idPaciente}`, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });
        const pacienteData = response.data;
        return pacienteData.celular || pacienteData.telefone || '0000000000';
    } catch (error) {
        console.error(`Erro ao buscar dados do paciente ${idPaciente}:`, error);
        return '0000000000';
    }
};

// Função para enviar confirmação para o webhook
const sendConfirmation = async (consulta) => {
    const pacienteNome = consulta.pacienteWs.nome || 'Desconhecido';
    const consultaData = formatDateTime(consulta.inicio);
    const pacienteId = consulta.pacienteWs.id || 'Desconhecido';
    const profissionalNome = consulta.itemAgendavelWs.nome || 'Desconhecido';
    const especialidade = consulta.especialidadeWs.nome || 'Desconhecido';
    const consultaId = consulta.id;
    // Obter número de telefone do paciente
    const telefone = await getPacienteTelefone(pacienteId);
    const telefoneFormatado = formatPhoneNumber(telefone);

    try {
        await axios.post('https://api.jimmy.chat/integration_webhook/in/route/459677560506470/0b523aec-a721-41d9-8892-0fa615244e1d', {
            pacienteId: pacienteId,
            telefone: telefoneFormatado,
            mensagem: `👋 Olá ${pacienteNome},\n
🆔 *ID do agendamento*: ${consultaId}\n
📅 Sua consulta está agendada para *${consultaData}*\n
com a Dra *${profissionalNome}, na especialidade de ${especialidade}*.\n
Na clínica Espaço Integrar Saúde.\n
📍Rua Conde de Bomfim 289A, sala 805
`
        });
        console.log(`Confirmação enviada para ${pacienteNome} para ${consultaData}, com ${profissionalNome}`);
    } catch (error) {
        console.error(`Erro ao enviar confirmação para ${pacienteNome}:`, error);
    }
};

// Função para enviar confirmações de consultas
const sendConfirmations = async () => {
    const consultasAmanha = await getConsultasAmanha();

    if (consultasAmanha.length === 0) {
        console.log('Não há consultas agendadas para o dia seguinte.');
        try {
            await axios.post('https://api.jimmy.chat/integration_webhook/in/route/459677560506470/0b523aec-a721-41d9-8892-0fa615244e1d', {
                mensagem: 'Não há consultas agendadas para o dia seguinte.',
                telefone: '0000000000'
            });
            console.log('Mensagem de ausência de consultas enviada ao webhook.');
        } catch (error) {
            console.error('Erro ao enviar mensagem de ausência de consultas:', error);
        }
    } else {
        console.log('Enviando confirmações para os clientes:');
        for (const consulta of consultasAmanha) {
            await sendConfirmation(consulta);
            // Adicionar um delay de 20 segundos entre envios
            await new Promise(resolve => setTimeout(resolve, 20000));
        }
    }
};

// Rota para receber itens agendáveis
app.post('/fetch-data', async (req, res) => {
    try {
        const response = await axios.get('https://app.conclinica.com.br/api/itensagendaveis', {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });
        const data = response.data;
        const resultadoFinal = [];

        for (const item of data) {
            console.log(`ID: ${item.id}, Nome: ${item.nome}`);
            const horariosOcupados = await fetchHorariosOcupados(item.id);
            const primeiroAtendimentos = horariosOcupados.filter(horario => horario.primeiroAtendimento === true);
            if (primeiroAtendimentos.length > 0) {
                resultadoFinal.push({
                    item: item,
                    primeiroAtendimentos: primeiroAtendimentos
                });
            }
        }
        res.send(resultadoFinal);
    } catch (error) {
        console.error('Erro ao buscar dados:', error);
        res.status(500).send('Erro ao buscar dados');
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);

    // Verificar imediatamente consultas do dia seguinte
    sendConfirmations();

    // Agendar tarefa diária às 11:00 BRT (14:00 UTC) para verificar consultas do dia seguinte
    cron.schedule('20 12 * * *', () => {
        console.log('Verificando consultas do dia seguinte...');
        sendConfirmations();
    });
});

