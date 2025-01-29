const _ = require('lodash')
const fs = require('fs')

const TASKS = _.shuffle(require('./data/tasks.json'))
const STAFFS = _.shuffle(require('./data/staffs.json'))
const REQUIREMENTS = require('./data/requirements.json')
const UNAVAILABLES = require('./data/unavailables.json')
const PREASSIGNED_TASKS = require('./data/preassigned.json')

const CONFLICTS = REQUIREMENTS.conflicts
const ONE_PERSON_TASKS = REQUIREMENTS.onePersonTasks

const workloads = STAFFS.map(({ name, shift }) => ({
  shift,
  name,
  workload: 0
}))

const schedules = [
  { name: 'mon', tasks: [] },
  { name: 'tue', tasks: [] },
  { name: 'wed', tasks: [] },
  { name: 'thu', tasks: [] },
  { name: 'fri', tasks: [] }
]

const unassignedTasks = []

schedules.forEach((schedule) => {
  const weekday = schedule.name
  const assignedSchedules = []

  TASKS.filter(({ weekdays }) => weekdays.includes(weekday)).forEach((task) => {
    const { name, cat, trainers, trainees, shifts, duration } = task
    const dayOffStaffs = UNAVAILABLES[weekday] || []

    shifts.forEach(function (shift) {
      const matchedTrainers = getMatchedTrainers(
        {
          name,
          cat,
          shift,
          trainers,
          trainees
        },
        assignedSchedules,
        dayOffStaffs
      )

      if (matchedTrainers.length == 0) {
        unassignedTasks.push({
          weekday,
          name,
          shift,
          trainers: _.map(getListShiftStaffs(trainers, shift), 'name'),
          trainees: _.map(getListShiftStaffs(trainees, shift), 'name')
        })
        return
      }

      const assignedTrainer = assignTrainer(matchedTrainers, workloads)

      const workingTrainees = assignTaskToTrainees(trainees, dayOffStaffs)

      updateWorkloads([assignedTrainer, ...workingTrainees], duration)

      assignedSchedules.push({
        name,
        shift,
        weekday,
        cat,
        trainer: assignedTrainer.name,
        trainees: workingTrainees
      })
    })
  })

  schedule.tasks = _.sortBy(assignedSchedules, [
    'shift',
    'staff',
    'cat',
    'name'
  ])
})

console.log('# Workloads:\n', _.sortBy(workloads, ['shift', 'name']))
console.log('\n')
console.log('# Unassigned Tasks:\n', unassignedTasks)

const flattenSchedules = _.reduce(
  schedules,
  (prev, task) => {
    prev.push(...task.tasks)
    return prev
  },
  []
)
const traineeSchedules = flattenSchedules.filter(
  ({ trainees }) => trainees.length > 0
)

const result = _(flattenSchedules)
  .groupBy('shift')
  .mapValues((task) => {
    const groupedTasks = _.groupBy(task, 'trainer')
    const result = _.mapValues(groupedTasks, (task) => {
      return _.groupBy(task, 'weekday')
    })
    return result
  })
  .value()

const writeFileData = [
  { filename: './out/assignedSchedules.json', content: result },
  { filename: './out/traineeSchedules.json', content: traineeSchedules },
  { filename: './out/workloads.json', content: workloads },
  { filename: './out/unassignedTasks.json', content: unassignedTasks },
  { filename: './out/dayOffs.json', content: UNAVAILABLES }
]

writeFileData.forEach(({ filename, content }) => {
  fs.writeFileSync(filename, JSON.stringify(content, null, 2), 'utf8')
})

function getMatchedTrainers(task, assignedTasks, dayOffStaffs) {
  const { name, cat, shift, trainers, trainees } = task

  const preassignedStaffs = _(STAFFS)
    .shuffle()
    .filter((s) => {
      const found = PREASSIGNED_TASKS.find((t) => {
        return t.name == name && t.shift == shift
      })

      if (found) {
        return found.staffs.includes(s.name) && !dayOffStaffs.includes(s.name)
      }

      return false
    })
    .value()

  if (preassignedStaffs.length > 0) return preassignedStaffs

  const matchedStaffs = _.filter(STAFFS, (s) => {
    if (dayOffStaffs.includes(s.name)) return false

    if (trainees.length == 0) {
      // CONFLICTS is a 2D array
      const conflictCategories = _(CONFLICTS)
        .filter((pairs) => pairs.includes(cat))
        .flatten()
        .filter((c) => c != cat)
        .value()

      const doingConflictedTaskStaffs = assignedTasks.filter((t) => {
        // check if the staff assigned to any conflict task
        return t.trainer == s.name && conflictCategories.includes(t.cat)
      })

      if (doingConflictedTaskStaffs.length > 0) {
        return false
      }
    }
    return s.shift == shift && _.includes(trainers, s.name)
  })

  const assignedOnePersonTaskStaffs = _.filter(matchedStaffs, (s) => {
    const isOnePersonTask = ONE_PERSON_TASKS.includes(cat)
    if (isOnePersonTask) {
      const assignedOnePersonTasks = assignedTasks.filter((t) => {
        return t.cat == cat && t.shift == s.shift
      })
      if (assignedOnePersonTasks.length == 0) return true

      const found = assignedOnePersonTasks.find(
        (t) => t.trainer == s.name && t.shift == s.shift
      )

      if (found) return true

      return false
    }

    return true
  })

  if (assignedOnePersonTaskStaffs.length > 0) return assignedOnePersonTaskStaffs
  return matchedStaffs
}

function assignTrainer(matchedStaffs, workloads) {
  return _.sortBy(
    matchedStaffs,
    function (s) {
      const found = workloads.find((w) => w.name == s.name)
      if (found) {
        return found.workload
      }
      return 0
    },
    ['desc']
  )[0]
}

function assignTaskToTrainees(trainees, dayOffStaffs) {
  return _.filter(trainees, function (trainee) {
    return !dayOffStaffs.includes(trainee)
  })
}

function updateWorkloads(staffs, duration) {
  staffs.forEach((staff) => {
    const found = workloads.find((w) => w.name == staff.name)
    if (found) {
      found.workload += duration
    }
  })
}

function getListShiftStaffs(list, shift) {
  return _.filter(STAFFS, (s) => {
    return s.shift == shift && list.includes(s.name)
  })
}
